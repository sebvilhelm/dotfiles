import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CLICKHOUSE_MCP_URL, ClickHouseAuthenticationError } from "./core.ts";

const KEYCHAIN_SERVICE = "pi-mcp-adapter.oauth";
const SERVER_NAME = "clickhouse";
const CALLBACK_PATH = "/callback";
const CLIENT_NAME = "pi-clickhouse";
const DEFAULT_CALLBACK_PORT = 39123;

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  issuer?: string;
}

interface StoredClient {
  clientId: string;
  clientSecret?: string;
  redirectUris?: string[];
  issuer?: string;
}

interface AuthEntry {
  tokens?: StoredTokens;
  clientInfo?: StoredClient;
  serverUrl?: string;
}

interface ChunkManifest {
  __piMcpAdapterOAuthChunked: 1;
  chunkCount: number;
  chunkDigest: string;
}

let cachedEntry: AuthEntry | undefined;

function accountName(): string {
  return `sha256-${
    createHash("sha256").update(SERVER_NAME, "utf8").digest("hex")
  }`;
}

function readKeychainEntry(account: string): string {
  return execFileSync("security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000,
  }).trim();
}

function removeKeychainEntry(account: string): void {
  execFileSync("security", [
    "delete-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
  ], { stdio: ["ignore", "ignore", "pipe"], timeout: 2_000 });
}

function parseChunkManifest(payload: string): ChunkManifest | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const manifest = parsed as Partial<ChunkManifest>;
    if (
      manifest.__piMcpAdapterOAuthChunked !== 1 ||
      !Number.isInteger(manifest.chunkCount) ||
      manifest.chunkCount === undefined ||
      manifest.chunkCount <= 0 ||
      typeof manifest.chunkDigest !== "string" ||
      !/^[a-f0-9]{16}$/.test(manifest.chunkDigest)
    ) return undefined;
    return manifest as ChunkManifest;
  } catch {
    return undefined;
  }
}

function chunkAccount(manifest: ChunkManifest, index: number): string {
  return `${accountName()}.chunk.${manifest.chunkDigest}.${index}`;
}

function readChunkManifest(): ChunkManifest | undefined {
  try {
    return parseChunkManifest(readKeychainEntry(accountName()));
  } catch {
    return undefined;
  }
}

function removeChunkPayloads(manifest: ChunkManifest): void {
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    removeKeychainEntry(chunkAccount(manifest, index));
  }
}

function keychainPayload(): string | undefined {
  try {
    const payload = readKeychainEntry(accountName());
    const manifest = parseChunkManifest(payload);
    if (!manifest) return payload;
    let combined = "";
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      combined += readKeychainEntry(chunkAccount(manifest, index));
    }
    return combined;
  } catch {
    return undefined;
  }
}

function readEntry(): AuthEntry | undefined {
  const payload = keychainPayload();
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as AuthEntry;
  } catch {
    return undefined;
  }
}

function writeEntry(entry: AuthEntry): void {
  const payload = JSON.stringify(entry);
  const previousManifest = readChunkManifest();
  try {
    execFileSync("security", [
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      accountName(),
      "-w",
      payload,
    ], { stdio: ["ignore", "ignore", "pipe"], timeout: 2_000 });
  } catch {
    throw new Error("Unable to write ClickHouse credentials to Keychain");
  }
  if (previousManifest) {
    try {
      removeChunkPayloads(previousManifest);
    } catch {
      // The new root credential is usable even if stale chunks cannot be removed.
    }
  }
}

async function discover(): Promise<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
}> {
  const response = await fetch(
    new URL(".well-known/oauth-authorization-server", CLICKHOUSE_MCP_URL),
  );
  if (!response.ok) {
    throw new Error(`OAuth discovery failed (${response.status})`);
  }
  return await response.json() as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    code_challenge_methods_supported?: string[];
  };
}

function randomUrlSafe(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function registerClient(
  metadata: Awaited<ReturnType<typeof discover>>,
  redirectUri: string,
): Promise<StoredClient> {
  if (!metadata.registration_endpoint) {
    throw new Error("ClickHouse OAuth does not advertise client registration");
  }
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: CLIENT_NAME,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) {
    throw new Error(`OAuth client registration failed (${response.status})`);
  }
  const body = await response.json() as {
    client_id?: string;
    client_secret?: string;
  };
  if (!body.client_id) {
    throw new Error("OAuth registration returned no client ID");
  }
  return {
    clientId: body.client_id,
    ...(body.client_secret ? { clientSecret: body.client_secret } : {}),
    redirectUris: [redirectUri],
    issuer: metadata.issuer,
  };
}

async function waitForRedirect(
  port: number,
  state: string,
): Promise<{ code: string }> {
  return await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid OAuth state");
        reject(new Error("OAuth state mismatch"));
        server.close();
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        response.writeHead(400).end("Missing authorization code");
        reject(new Error("OAuth callback did not contain a code"));
        server.close();
        return;
      }
      response.end(
        "ClickHouse authentication completed. You can close this tab.",
      );
      resolve({ code });
      server.close();
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

async function refresh(
  metadata: Awaited<ReturnType<typeof discover>>,
  entry: AuthEntry,
): Promise<string | undefined> {
  const tokens = entry.tokens;
  if (!tokens?.refreshToken || !entry.clientInfo) return undefined;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: entry.clientInfo.clientId,
    resource: new URL(CLICKHOUSE_MCP_URL).origin + "/",
  });
  if (entry.clientInfo.clientSecret) {
    body.set("client_secret", entry.clientInfo.clientSecret);
  }
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return undefined;
  const result = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!result.access_token) return undefined;
  entry.tokens = {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? tokens.refreshToken,
    ...(result.expires_in !== undefined
      ? { expiresAt: Date.now() / 1000 + result.expires_in }
      : {}),
    ...(result.scope ? { scope: result.scope } : {}),
    issuer: metadata.issuer,
  };
  writeEntry(entry);
  return result.access_token;
}

export function createAccessTokenProvider(): (
  signal?: AbortSignal,
) => Promise<string> {
  return async () => {
    const configured = process.env.CLICKHOUSE_MCP_ACCESS_TOKEN;
    if (configured) return configured;

    const entry = cachedEntry ?? readEntry();
    if (!entry) {
      throw new ClickHouseAuthenticationError(
        "No ClickHouse OAuth credential is available. Run /clickhouse-auth or set CLICKHOUSE_MCP_ACCESS_TOKEN",
      );
    }
    if (!entry.tokens?.accessToken) {
      throw new ClickHouseAuthenticationError(
        "The stored ClickHouse credential has no access token. Run /clickhouse-auth again",
      );
    }
    {
      const expiresAt = entry.tokens.expiresAt;
      if (!expiresAt || expiresAt > Date.now() / 1000 + 60) {
        cachedEntry = entry;
        return entry.tokens.accessToken;
      }
      const metadata = await discover();
      const refreshed = await refresh(metadata, entry);
      if (refreshed) {
        cachedEntry = entry;
        return refreshed;
      }
    }
    throw new ClickHouseAuthenticationError(
      "The ClickHouse access token expired and could not be refreshed. Run /clickhouse-auth again",
    );
  };
}

export async function authenticateClickHouse(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (process.env.CLICKHOUSE_MCP_ACCESS_TOKEN) {
    ctx.ui.notify("CLICKHOUSE_MCP_ACCESS_TOKEN is already configured", "info");
    return;
  }
  const metadata = await discover();
  const port = Number(
    process.env.PI_CLICKHOUSE_MCP_CALLBACK_PORT ?? DEFAULT_CALLBACK_PORT,
  );
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind OAuth callback");
  }
  server.close();
  const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  const client = readEntry()?.clientInfo?.redirectUris?.includes(redirectUri)
    ? readEntry()!.clientInfo!
    : await registerClient(metadata, redirectUri);
  const verifier = randomUrlSafe();
  const state = randomUrlSafe();
  const challenge = await sha256Base64Url(verifier);
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    resource: new URL(CLICKHOUSE_MCP_URL).origin + "/",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const opened = await pi.exec("open", [authorization.toString()]);
  if (opened.code !== 0) {
    ctx.ui.notify(`Open this URL to authenticate: ${authorization}`, "warning");
  } else {
    ctx.ui.notify("Opened ClickHouse authentication in your browser", "info");
  }
  const callback = await waitForRedirect(address.port, state);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: callback.code,
    client_id: client.clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: new URL(CLICKHOUSE_MCP_URL).origin + "/",
  });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }
  const tokens = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokens.access_token) {
    throw new Error("OAuth token response had no access token");
  }
  writeEntry({
    serverUrl: CLICKHOUSE_MCP_URL,
    clientInfo: client,
    tokens: {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(tokens.expires_in !== undefined
        ? { expiresAt: Date.now() / 1000 + tokens.expires_in }
        : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      issuer: metadata.issuer,
    },
  });
  cachedEntry = undefined;
  ctx.ui.notify("ClickHouse authentication completed", "info");
}

export function logoutClickHouse(ctx: ExtensionContext): void {
  cachedEntry = undefined;
  const manifest = readChunkManifest();
  try {
    if (manifest) removeChunkPayloads(manifest);
    removeKeychainEntry(accountName());
  } catch {
    ctx.ui.notify("No stored ClickHouse credentials found", "info");
    return;
  }
  ctx.ui.notify("ClickHouse credentials removed", "info");
}

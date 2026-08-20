export const CLICKHOUSE_MCP_URL = "https://clickhouse-mcp.prod.lunar.tech/mcp";

const CLIENT_INFO = {
  name: "pi-clickhouse",
  version: "1.0.0",
} as const;
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const MAX_ERROR_BODY_LENGTH = 1_000;

export type McpContent =
  | { type: "text"; text: string }
  | { type: string; [key: string]: unknown };

export interface McpCallToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface AccessTokenProvider {
  (signal?: AbortSignal): Promise<string>;
}

export class ClickHouseAuthenticationError extends Error {
  constructor(message = "ClickHouse authentication is required") {
    super(message);
    this.name = "ClickHouseAuthenticationError";
  }
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

interface InitializeResult {
  protocolVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return false;
  if ("error" in value) {
    return isRecord(value.error) &&
      typeof value.error.code === "number" &&
      typeof value.error.message === "string";
  }
  return ("id" in value) && ("result" in value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error("ClickHouse MCP returned invalid JSON", { cause: error });
  }
}

export function parseMcpResponse(body: string, contentType: string): unknown {
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    return parseJson(body);
  }

  const events = body.split(/\r?\n\r?\n/);
  for (const event of events) {
    const payload = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload || payload === "[DONE]") continue;

    const parsed = parseJson(payload);
    if (isJsonRpcResponse(parsed)) return parsed;
  }

  throw new Error("ClickHouse MCP returned an empty event stream");
}

function rpcResult<T>(response: unknown): T {
  if (!isJsonRpcResponse(response)) {
    throw new Error("ClickHouse MCP returned an invalid JSON-RPC response");
  }
  if ("error" in response) {
    throw new Error(
      `ClickHouse MCP error ${response.error.code}: ${response.error.message}`,
    );
  }
  return response.result as T;
}

function toolResult(value: unknown): McpCallToolResult {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error("ClickHouse MCP returned an invalid tool result");
  }

  const content = value.content.filter(
    (item): item is McpContent =>
      isRecord(item) &&
      typeof item.type === "string" &&
      (item.type !== "text" || typeof item.text === "string"),
  );
  if (content.length !== value.content.length) {
    throw new Error("ClickHouse MCP returned invalid tool content");
  }

  return {
    content,
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...("structuredContent" in value
      ? { structuredContent: value.structuredContent }
      : {}),
  };
}

export function toolResultText(result: McpCallToolResult): string {
  const text = result.content
    .filter(
      (item): item is Extract<McpContent, { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");

  if (text) return text;
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent, null, 2);
  }
  return "(ClickHouse MCP returned no text content)";
}

async function responseError(response: Response): Promise<Error> {
  if (response.status === 401 || response.status === 403) {
    return new ClickHouseAuthenticationError(
      `ClickHouse authentication failed (${response.status})`,
    );
  }

  const body = (await response.text().catch(() => "")).trim();
  const suffix = body
    ? `: ${body.slice(0, MAX_ERROR_BODY_LENGTH)}`
    : response.statusText
    ? `: ${response.statusText}`
    : "";
  return new Error(
    `ClickHouse MCP request failed (${response.status})${suffix}`,
  );
}

export class ClickHouseMcpClient {
  readonly #endpoint: URL;
  readonly #getAccessToken: AccessTokenProvider;
  readonly #fetch: typeof fetch;
  #nextRequestId = 1;

  constructor(
    getAccessToken: AccessTokenProvider,
    options: {
      endpoint?: string | URL;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.#endpoint = new URL(options.endpoint ?? CLICKHOUSE_MCP_URL);
    this.#getAccessToken = getAccessToken;
    this.#fetch = options.fetch ?? fetch;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallToolResult> {
    signal?.throwIfAborted();
    const accessToken = await this.#getAccessToken(signal);
    if (!accessToken) throw new ClickHouseAuthenticationError();

    const initialized = await this.#request<InitializeResult>(
      accessToken,
      "initialize",
      {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      undefined,
      signal,
    );
    const protocolVersion =
      typeof initialized.result.protocolVersion === "string"
        ? initialized.result.protocolVersion
        : DEFAULT_PROTOCOL_VERSION;

    try {
      await this.#notifyInitialized(
        accessToken,
        initialized.sessionId,
        protocolVersion,
        signal,
      );
      const called = await this.#request<unknown>(
        accessToken,
        "tools/call",
        { name, arguments: args },
        initialized.sessionId,
        signal,
        protocolVersion,
      );
      const result = toolResult(called.result);
      if (result.isError) {
        throw new Error(toolResultText(result));
      }
      return result;
    } finally {
      if (initialized.sessionId) {
        await this.#closeSession(
          accessToken,
          initialized.sessionId,
          protocolVersion,
        );
      }
    }
  }

  async #request<T>(
    accessToken: string,
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
    signal: AbortSignal | undefined,
    protocolVersion = DEFAULT_PROTOCOL_VERSION,
  ): Promise<{ result: T; sessionId?: string }> {
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: this.#headers(
        accessToken,
        sessionId,
        protocolVersion,
      ),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.#nextRequestId++,
        method,
        params,
      }),
      signal,
    });
    if (!response.ok) throw await responseError(response);

    const body = await response.text();
    const parsed = parseMcpResponse(
      body,
      response.headers.get("content-type") ?? "application/json",
    );
    const responseSessionId = response.headers.get("mcp-session-id") ??
      sessionId;
    return {
      result: rpcResult<T>(parsed),
      ...(responseSessionId ? { sessionId: responseSessionId } : {}),
    };
  }

  async #notifyInitialized(
    accessToken: string,
    sessionId: string | undefined,
    protocolVersion: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: this.#headers(accessToken, sessionId, protocolVersion),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      signal,
    });
    if (!response.ok) throw await responseError(response);
  }

  async #closeSession(
    accessToken: string,
    sessionId: string,
    protocolVersion: string,
  ): Promise<void> {
    try {
      await this.#fetch(this.#endpoint, {
        method: "DELETE",
        headers: this.#headers(accessToken, sessionId, protocolVersion),
      });
    } catch {
      // Session deletion is best-effort and must not hide the tool result.
    }
  }

  #headers(
    accessToken: string,
    sessionId: string | undefined,
    protocolVersion: string,
  ): Headers {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": protocolVersion,
    });
    if (sessionId) headers.set("Mcp-Session-Id", sessionId);
    return headers;
  }
}

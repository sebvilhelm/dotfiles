import assert from "node:assert/strict";
import {
  ClickHouseAuthenticationError,
  ClickHouseMcpClient,
  parseMcpResponse,
  toolResultText,
} from "./core.ts";

function response(body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

Deno.test("parses JSON and SSE MCP responses", () => {
  const message = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "ok" }] },
  });
  assert.deepEqual(
    parseMcpResponse(message, "application/json"),
    JSON.parse(message),
  );
  assert.deepEqual(
    parseMcpResponse(
      `event: message\n\ndata: ${message}\n\n`,
      "text/event-stream",
    ),
    JSON.parse(message),
  );
});

Deno.test("calls, initializes, and closes a Streamable HTTP session", async () => {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (requests.length === 1) {
      return response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2025-03-26" },
        }),
        { "mcp-session-id": "session-1" },
      );
    }
    if (requests.length === 2) return new Response(null, { status: 202 });
    if (requests.length === 3) {
      return response(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "ok" }] },
      }));
    }
    return new Response(null, { status: 200 });
  };
  const client = new ClickHouseMcpClient(async () => "token", {
    endpoint: "https://example.test/mcp",
    fetch: fetcher,
  });
  const result = await client.callTool("run_query", { query: "SELECT 1" });

  assert.equal(toolResultText(result), "ok");
  assert.equal(requests.length, 4);
  assert.equal(requests[0].headers.get("authorization"), "Bearer token");
  assert.equal(requests[1].headers.get("mcp-session-id"), "session-1");
  assert.equal(requests[2].headers.get("mcp-session-id"), "session-1");
  assert.equal(requests[3].method, "DELETE");
});

Deno.test("reports HTTP authentication failures", async () => {
  const client = new ClickHouseMcpClient(async () => "token", {
    fetch: async () => new Response("unauthorized", { status: 401 }),
  });
  await assert.rejects(
    client.callTool("list_databases", {}),
    ClickHouseAuthenticationError,
  );
});

Deno.test("reports MCP tool errors", async () => {
  const client = new ClickHouseMcpClient(async () => "token", {
    fetch: async () =>
      response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2025-03-26" },
        }),
        { "mcp-session-id": "session-1" },
      ),
  });
  await assert.rejects(
    client.callTool("run_query", { query: "bad" }),
    /invalid/,
  );
});

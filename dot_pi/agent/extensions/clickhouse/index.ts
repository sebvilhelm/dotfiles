import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  authenticateClickHouse,
  createAccessTokenProvider,
  logoutClickHouse,
} from "./auth.ts";
import {
  CLICKHOUSE_MCP_URL,
  ClickHouseMcpClient,
  toolResultText,
} from "./core.ts";

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2_000;

function bounded(text: string): string {
  const result = truncateHead(text, {
    maxBytes: MAX_OUTPUT_BYTES,
    maxLines: MAX_OUTPUT_LINES,
  });
  if (!result.truncated) return result.content;
  return `${result.content}\n\n[Output truncated: ${result.outputLines} of ${result.totalLines} lines; ${result.outputBytes} of ${result.totalBytes} bytes]`;
}

export default function clickHouseExtension(pi: ExtensionAPI): void {
  const client = new ClickHouseMcpClient(createAccessTokenProvider());

  pi.registerTool({
    name: "clickhouse_list_databases",
    label: "ClickHouse: List Databases",
    description: "List available ClickHouse databases.",
    promptSnippet: "List available ClickHouse databases",
    promptGuidelines: [
      "Use clickhouse_list_databases before querying an unfamiliar ClickHouse database.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, signal) {
      const result = await client.callTool("list_databases", {}, signal);
      return {
        content: [{
          type: "text" as const,
          text: bounded(toolResultText(result)),
        }],
        details: { server: CLICKHOUSE_MCP_URL, tool: "list_databases" },
      };
    },
  });

  pi.registerTool({
    name: "clickhouse_list_tables",
    label: "ClickHouse: List Tables",
    description:
      "List ClickHouse tables in a database, including schema, comments, row counts, and column counts.",
    promptSnippet: "List tables and schema in a ClickHouse database",
    promptGuidelines: [
      "Use clickhouse_list_tables to inspect ClickHouse schema before writing queries.",
    ],
    parameters: Type.Object({
      database: Type.String({ description: "Database name" }),
      like: Type.Optional(
        Type.String({ description: "Optional table LIKE pattern" }),
      ),
      not_like: Type.Optional(
        Type.String({ description: "Optional table NOT LIKE pattern" }),
      ),
      page_token: Type.Optional(
        Type.String({ description: "Pagination token" }),
      ),
      page_size: Type.Optional(
        Type.Integer({ minimum: 1, description: "Page size (default: 50)" }),
      ),
      include_detailed_columns: Type.Optional(
        Type.Boolean({
          description: "Include detailed column metadata (default: true)",
        }),
      ),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal) {
      const result = await client.callTool("list_tables", params, signal);
      return {
        content: [{
          type: "text" as const,
          text: bounded(toolResultText(result)),
        }],
        details: { server: CLICKHOUSE_MCP_URL, tool: "list_tables" },
      };
    },
  });

  pi.registerTool({
    name: "clickhouse_run_query",
    label: "ClickHouse: Run Query",
    description:
      "Execute a ClickHouse SQL query. The server runs queries read-only by default.",
    promptSnippet: "Run a read-only SQL query in ClickHouse",
    promptGuidelines: [
      "Use clickhouse_run_query for ClickHouse SQL; prefer explicit columns and bounded result sets.",
      "Treat clickhouse_run_query as read-only unless the server configuration explicitly permits writes.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "ClickHouse SQL query" }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal) {
      const result = await client.callTool("run_query", params, signal);
      return {
        content: [{
          type: "text" as const,
          text: bounded(toolResultText(result)),
        }],
        details: { server: CLICKHOUSE_MCP_URL, tool: "run_query" },
      };
    },
  });

  pi.registerCommand("clickhouse-auth", {
    description: "Authenticate this Pi installation with ClickHouse MCP",
    handler: async (_args, ctx) => {
      await authenticateClickHouse(pi, ctx);
    },
  });

  pi.registerCommand("clickhouse-logout", {
    description: "Remove stored ClickHouse MCP credentials",
    handler: async (_args, ctx) => {
      logoutClickHouse(ctx);
    },
  });
}

/**
 * Web Search Extension
 *
 * Registers a `web_search` tool backed only by Exa's public MCP endpoint.
 * No Kagi token or Exa API key is required.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const CONTEXT_MAX_CHARACTERS = 3000;

interface ExaMcpRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

interface ExaParsedResult {
  title: string;
  url: string;
  published?: string;
  author?: string;
  content: string;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_RESULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(limit)));
}

/** Send a JSON-RPC tool call to the Exa MCP endpoint. */
async function callExaMcp(
  query: string,
  numResults: number,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query,
          numResults,
          livecrawl: "fallback",
          type: "auto",
          contextMaxCharacters: CONTEXT_MAX_CHARACTERS,
        },
      },
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Exa MCP error (${response.status}): ${
        text.slice(0, 300) || response.statusText
      }`
    );
  }

  const body = await response.text();
  const parsed = parseExaMcpResponse(body);

  if (parsed.error) {
    const code =
      typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
    throw new Error(
      `Exa MCP error${code}: ${parsed.error.message || "Unknown error"}`
    );
  }

  if (parsed.result?.isError) {
    const message = parsed.result.content
      ?.find((item) => item.type === "text" && item.text?.trim())
      ?.text?.trim();
    throw new Error(message || "Exa MCP returned an error");
  }

  const text = parsed.result?.content?.find(
    (item) =>
      item.type === "text" &&
      typeof item.text === "string" &&
      item.text.trim().length > 0
  )?.text;

  if (!text) {
    throw new Error("Exa MCP returned empty content");
  }

  return text;
}

function parseExaMcpResponse(body: string): ExaMcpRpcResponse {
  const dataLines = body
    .split("\n")
    .filter((line) => line.trimStart().startsWith("data:"));

  for (const line of dataLines) {
    const payload = line.slice(line.indexOf("data:") + 5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      const candidate = JSON.parse(payload) as ExaMcpRpcResponse;
      if (candidate.result || candidate.error) {
        return candidate;
      }
    } catch {}
  }

  try {
    const candidate = JSON.parse(body) as ExaMcpRpcResponse;
    if (candidate.result || candidate.error) {
      return candidate;
    }
  } catch {}

  throw new Error("Exa MCP returned an empty response");
}

/** Parse the MCP text blob into structured results. */
function parseExaResults(text: string): ExaParsedResult[] {
  const blocks = text
    .split(/(?=^Title: )/m)
    .filter((block) => block.trim().length > 0);

  return blocks
    .map((block) => {
      const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
      const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
      const published = block.match(/^Published: (.+)/m)?.[1]?.trim();
      const author = block.match(/^Author: (.+)/m)?.[1]?.trim();
      let content = "";

      const textStart = block.indexOf("\nText: ");
      if (textStart >= 0) {
        content = block.slice(textStart + 7).trim();
      } else {
        const highlightsMatch = block.match(/\nHighlights:\s*\n/);
        if (highlightsMatch?.index != null) {
          content = block
            .slice(highlightsMatch.index + highlightsMatch[0].length)
            .trim();
        }
      }

      content = content.replace(/\n---\s*$/, "").trim();

      return {
        title,
        url,
        published: published && published !== "N/A" ? published : undefined,
        author: author && author !== "N/A" ? author : undefined,
        content,
      };
    })
    .filter((result) => result.url.length > 0);
}

function formatExaResults(results: ExaParsedResult[]): string {
  return results
    .map((result) => {
      let entry = `## ${result.title || "(no title)"}\n${result.url}`;
      if (result.published) {
        entry += `\nPublished: ${result.published}`;
      }
      if (result.author) {
        entry += `\nAuthor: ${result.author}`;
      }
      if (result.content) {
        entry += `\n${result.content}`;
      }
      return entry;
    })
    .join("\n\n");
}

async function searchExa(
  query: string,
  limit: number | undefined,
  signal?: AbortSignal
) {
  const numResults = normalizeLimit(limit);
  const text = await callExaMcp(query, numResults, signal);
  const results = parseExaResults(text);

  return {
    content: [
      {
        type: "text" as const,
        text:
          results.length > 0 ? formatExaResults(results) : "No results found.",
      },
    ],
    details: {
      provider: "exa-mcp",
      query,
      resultCount: results.length,
      requestedResultCount: numResults,
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export default function webSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Exa. Returns a list of results with titles, URLs, and snippets.",
    promptSnippet: "Search the web for current information",
    promptGuidelines: [
      "Use web_search when the user asks for information that may require up-to-date web results.",
      "Prefer specific, targeted queries over broad ones.",
      "Summarize web_search results for the user rather than dumping raw output.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(
        Type.Number({
          description: `Max number of results, clamped to 1-${MAX_RESULT_LIMIT} (default: ${DEFAULT_RESULT_LIMIT})`,
        })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      try {
        return await searchExa(params.query, params.limit, signal);
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return {
            content: [{ type: "text" as const, text: "Search cancelled." }],
          };
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Exa search failed: ${message}`);
      }
    },
  });
}

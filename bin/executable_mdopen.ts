#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

import { micromark } from "npm:micromark@4.0.2";
import { gfm, gfmHtml } from "npm:micromark-extension-gfm@3.0.0";
import type {} from "npm:micromark-extension-gfm-task-list-item@2.1.0";

const HELP = `Usage: mdopen.ts [--no-open] <markdown-file>

Render a markdown file to a temporary HTML file and open it in the browser.
Mermaid code fences are rendered client-side with Pele in the generated page.
Task checkboxes are interactive; changes are not saved to the markdown file.

Options:
  --no-open   Generate the HTML file but do not open it
  -h, --help  Show this help
`;

async function main() {
  const args = [...Deno.args];
  const noOpenIndex = args.indexOf("--no-open");
  const noOpen = noOpenIndex !== -1;

  if (noOpen) {
    args.splice(noOpenIndex, 1);
  }

  if (args.includes("-h") || args.includes("--help")) {
    console.log(HELP.trimEnd());
    return;
  }

  const inputPath = args[0];
  if (!inputPath || args.length !== 1) {
    console.error(HELP.trimEnd());
    Deno.exit(1);
  }

  const absolutePath = await Deno.realPath(inputPath).catch(() => {
    console.error(`File not found: ${inputPath}`);
    Deno.exit(1);
  });

  const markdown = await Deno.readTextFile(absolutePath).catch(
    (error: unknown) => {
      console.error(`Could not read ${absolutePath}`);
      if (error instanceof Error) {
        console.error(error.message);
      }
      Deno.exit(1);
    },
  );

  const title = fileNameFromPath(absolutePath);
  const html = buildDocument({
    title,
    sourcePath: absolutePath,
    body: renderMarkdown(markdown),
  });

  const outputPath = await Deno.makeTempFile({
    prefix: `mdopen-${safeStem(title)}-`,
    suffix: ".html",
  });

  await Deno.writeTextFile(outputPath, html);
  console.log(outputPath);

  if (!noOpen) {
    const command = new Deno.Command("open", {
      args: [outputPath],
      stdout: "null",
      stderr: "piped",
    });
    const { code, stderr } = await command.output();
    if (code !== 0) {
      console.error(
        new TextDecoder().decode(stderr).trim() || "Failed to open browser",
      );
      Deno.exit(code);
    }
  }
}

function renderMarkdown(markdown: string): string {
  const rendered = micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml(), {
      enter: {
        taskListCheck() {
          this.tag('<input type="checkbox" ');
        },
      },
    }],
  });

  return rewriteMermaidBlocks(rendered);
}

function rewriteMermaidBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_match, encodedSource: string) => {
      const source = decodeHtmlEntities(encodedSource)
        .replace(/\r\n?/g, "\n")
        .replace(/\n$/, "");
      return `<div class="mermaid">${escapeHtml(source)}</div>`;
    },
  );
}

function buildDocument(
  { title, sourcePath, body }: {
    title: string;
    sourcePath: string;
    body: string;
  },
): string {
  const scriptSourcePath = JSON.stringify(sourcePath);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --fg: #1f2328;
        --muted: #59636e;
        --border: #d0d7de;
        --code-bg: #f6f8fa;
        --link: #0969da;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 2rem;
        font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--fg);
        background: var(--bg);
      }

      main {
        max-width: 56rem;
        margin: 0 auto 4rem;
      }

      a {
        color: var(--link);
      }

      img {
        max-width: 100%;
        height: auto;
      }

      pre,
      code {
        font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Consolas, monospace;
      }

      code {
        padding: 0.15em 0.3em;
        border-radius: 0.25rem;
        background: var(--code-bg);
      }

      pre {
        overflow-x: auto;
        padding: 1rem;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--code-bg);
      }

      pre code {
        padding: 0;
        background: transparent;
      }

      blockquote {
        margin: 0;
        padding-left: 1rem;
        border-left: 0.25rem solid var(--border);
        color: var(--muted);
      }

      table {
        border-collapse: collapse;
        width: 100%;
      }

      th,
      td {
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border);
        text-align: left;
      }

      hr {
        border: 0;
        border-top: 1px solid var(--border);
        margin: 2rem 0;
      }

      .source-path {
        margin-bottom: 2rem;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .mermaid {
        overflow-x: auto;
        margin: 1.5rem 0;
        --pele-bg: var(--bg);
        --pele-fg: var(--fg);
        --pele-muted: var(--muted);
        --pele-line: var(--fg);
        --pele-surface: var(--code-bg);
        --pele-border: var(--border);
        --pele-accent: var(--link);
        --pele-error: #d1242f;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="source-path">${escapeHtml(sourcePath)}</div>
      ${body}
    </main>
    <script type="module">
      import { mount } from "https://cdn.jsdelivr.net/npm/pele@1.6.0/dist/pele.js";

      const sourcePath = ${scriptSourcePath};
      const sourceUrl = new URL(sourcePath, "file://");

      for (const image of document.querySelectorAll("img[src]")) {
        const src = image.getAttribute("src");
        if (!src || src.startsWith("#") || /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(src)) {
          continue;
        }
        image.src = new URL(src, sourceUrl).href;
      }

      for (const link of document.querySelectorAll("a[href]")) {
        const href = link.getAttribute("href");
        if (!href || href.startsWith("#") || /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(href)) {
          continue;
        }
        link.href = new URL(href, sourceUrl).href;
      }

      for (const element of document.querySelectorAll(".mermaid")) {
        mount(element, element.textContent, { onError: console.error });
      }
    </script>
  </body>
</html>`;
}

function fileNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function safeStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") ||
    "note";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtmlEntities(value: string): string {
  return value.replaceAll(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g,
    (entity) => {
      switch (entity) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          if (entity.startsWith("&#x")) {
            return String.fromCodePoint(
              Number.parseInt(entity.slice(3, -1), 16),
            );
          }
          if (entity.startsWith("&#")) {
            return String.fromCodePoint(
              Number.parseInt(entity.slice(2, -1), 10),
            );
          }
          return entity;
      }
    },
  );
}

await main();

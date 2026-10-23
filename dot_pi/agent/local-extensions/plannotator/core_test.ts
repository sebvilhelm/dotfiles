import assert from "node:assert/strict";

import { feedbackMessage, latestAssistantText } from "./core.ts";

Deno.test("latestAssistantText returns visible text from the newest assistant message", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Earlier" }],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden reasoning" },
          { type: "text", text: "Latest" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  assert.equal(latestAssistantText(entries), "Latest\nanswer");
});

Deno.test("latestAssistantText skips non-assistant, tool-only, and blank messages", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Useful" }],
      },
    },
    {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "User" }] },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call" }],
      },
    },
    {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "  " }] },
    },
  ];

  assert.equal(latestAssistantText(entries), "Useful");
  assert.equal(latestAssistantText([]), undefined);
});

Deno.test("feedbackMessage trims empty output and labels returned feedback", () => {
  assert.equal(feedbackMessage("last message", " \n "), undefined);
  assert.equal(
    feedbackMessage("code review", "  Fix the null handling.  "),
    "Plannotator feedback (code review):\n\nFix the null handling.",
  );
});

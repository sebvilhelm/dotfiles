function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" &&
    typeof value.text === "string";
}

/** Find the latest assistant message containing visible text on this branch. */
export function latestAssistantText(
  entries: readonly unknown[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (
      !isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)
    ) {
      continue;
    }

    const message = entry.message;
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    const text = message.content
      .filter(isTextBlock)
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return undefined;
}

export function feedbackMessage(
  label: string,
  output: string,
): string | undefined {
  const feedback = output.trim();
  if (!feedback) return undefined;
  return `Plannotator feedback (${label}):\n\n${feedback}`;
}

export const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
});

export function mcpResult(value) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { items: Array.isArray(value) ? value : [value] };
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent,
  };
}

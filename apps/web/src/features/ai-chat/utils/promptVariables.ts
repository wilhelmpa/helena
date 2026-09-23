const VARIABLE = /\{\{\s*([\p{L}\p{N}_ -]{1,40}?)\s*\}\}/gu;

// The variables of a saved prompt, `{{name}}`, each once and in the order they appear.
export function promptVariables(content: string): string[] {
  return [...new Set([...content.matchAll(VARIABLE)].map((match) => match[1].trim()))];
}

// The prompt with its variables filled in. One left without a value keeps its marker,
// so the member sees what is still missing.
export function fillPrompt(content: string, values: Record<string, string>): string {
  return content.replace(VARIABLE, (marker, name: string) => {
    const value = values[name.trim()];
    return value ? value : marker;
  });
}

// Explicit collection counts avoid recounting rows, and survive shortened context history.
export function boundedToolResult(text: string, limit: number): string {
  const suffix = '\n… (gekürzt)';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(0, limit - suffix.length)) + suffix.slice(0, limit);
  }
  const returnedCounts: Record<string, number> = {};
  if (Array.isArray(parsed)) returnedCounts['$'] = parsed.length;
  else if (parsed && typeof parsed === 'object') {
    const previous = parsed as { truncated?: boolean; returnedCounts?: unknown };
    if (
      previous.truncated === true &&
      previous.returnedCounts &&
      typeof previous.returnedCounts === 'object'
    ) {
      for (const [key, count] of Object.entries(previous.returnedCounts)) {
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0)
          returnedCounts[key] = count;
      }
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) returnedCounts[key] = value.length;
    }
  }
  if (text.length <= limit) {
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(returnedCounts).length
    ) {
      const annotated = JSON.stringify({ ...parsed, returnedCounts });
      if (annotated.length <= limit) return annotated;
    } else return text;
  }
  const render = (length: number) =>
    JSON.stringify({
      truncated: true,
      returnedCounts,
      notice: 'Preview shortened. Counts describe complete arrays returned by this call.',
      preview: text.slice(0, length),
    });
  if (render(0).length > limit) return JSON.stringify({ truncated: true }).slice(0, limit);
  let low = 0;
  let high = Math.min(text.length, limit);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (render(middle).length <= limit) low = middle;
    else high = middle - 1;
  }
  return render(low);
}

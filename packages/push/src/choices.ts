// Whether a device wants a category: its own switch, else the category's default.
export function wantsCategory(
  choices: Record<string, boolean> | null | undefined,
  category: string,
  defaultOn: boolean,
): boolean {
  const choice = choices?.[category];
  return typeof choice === 'boolean' ? choice : defaultOn;
}

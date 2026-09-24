// LIKE and ILIKE patterns built from text a person or an agent typed. Postgres reads a
// backslash as the escape character of a LIKE pattern, so escaping \, % and _ makes them
// match themselves: a search for "50%" finds "50%", not every value that starts with
// "50", and "_" is an underscore, not any character.
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// Finds the text anywhere in the value.
export function containsPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

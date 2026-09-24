// Enter in a note's title moves on to its text. Renaming the note gives it a new
// address, and the editor of the new address is a new one, so the wish to write is
// kept here for a moment and taken by the next editor that opens.
const WINDOW_MS = 5000;
let requestedAt = 0;

export function requestBodyFocus(): void {
  requestedAt = Date.now();
}

// True once, for the first editor that asks within the window.
export function takeBodyFocus(): boolean {
  const wanted = Date.now() - requestedAt < WINDOW_MS;
  requestedAt = 0;
  return wanted;
}

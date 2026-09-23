// How the chat lays itself out in the room its container gives it, in CSS pixels: from
// this width on the list is a column next to the conversation, below it a bar over the
// conversation that opens the list. Kept equal to the `@3xl/chat` container query.
export const CHAT_SPLIT_WIDTH = 768;

// From this width an artifact opens next to the conversation; below it, over it.
export const CHAT_ARTIFACT_SIDE_WIDTH = 1100;

export type ChatLayoutMode = 'split' | 'compact';

export function chatLayoutMode(width: number): ChatLayoutMode {
  return width >= CHAT_SPLIT_WIDTH ? 'split' : 'compact';
}

export function artifactPlacement(width: number): 'side' | 'overlay' {
  return width >= CHAT_ARTIFACT_SIDE_WIDTH ? 'side' : 'overlay';
}

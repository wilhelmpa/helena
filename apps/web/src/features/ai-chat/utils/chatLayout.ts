// How the chat lays itself out in the room its container gives it, in CSS pixels. The chat
// list lives in the sidebar (owner, O87); the workspace itself is only the conversation.

// From this width an artifact opens next to the conversation; below it, over it.
export const CHAT_ARTIFACT_SIDE_WIDTH = 1100;

export function artifactPlacement(width: number): 'side' | 'overlay' {
  return width >= CHAT_ARTIFACT_SIDE_WIDTH ? 'side' : 'overlay';
}

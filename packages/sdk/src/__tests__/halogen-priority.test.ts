import { expect, test } from 'bun:test';
import { normalizeHalogenPriority } from '../halogen-priority';

test('voice reply has its own validated ceiling', () => {
  expect(normalizeHalogenPriority({}).voiceReplyMaxTokens).toBe(512);
  expect(normalizeHalogenPriority({ voiceReplyMaxTokens: 4_096 }).voiceReplyMaxTokens).toBe(4_096);
  expect(normalizeHalogenPriority({ voiceReplyMaxTokens: 4_097 }).voiceReplyMaxTokens).toBe(512);
  expect(normalizeHalogenPriority({ interactiveMaxTokens: 4_096 }).voiceReplyMaxTokens).toBe(512);
});

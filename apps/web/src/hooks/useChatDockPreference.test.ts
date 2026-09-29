import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHAT_DOCK_DEFAULT,
  CHAT_DOCK_MIN_HEIGHT,
  clampChatDockHeight,
  parseChatDockPreference,
} from './useChatDockPreference';

describe('chat dock preference', () => {
  it('starts closed and reads what this device remembered', () => {
    assert.deepEqual(parseChatDockPreference(null), CHAT_DOCK_DEFAULT);
    assert.deepEqual(parseChatDockPreference('{"expanded":true,"height":400}'), {
      expanded: true,
      height: 400,
    });
    assert.deepEqual(parseChatDockPreference('not json'), CHAT_DOCK_DEFAULT);
    assert.deepEqual(parseChatDockPreference('{"expanded":"yes","height":"tall"}'), {
      expanded: false,
      height: CHAT_DOCK_DEFAULT.height,
    });
  });

  it('keeps the open chat between its minimum and three quarters of the panel', () => {
    assert.equal(clampChatDockHeight(20), CHAT_DOCK_MIN_HEIGHT);
    assert.equal(clampChatDockHeight(900, 800), 600);
    assert.equal(clampChatDockHeight(300, 800), 300);
    // A tiny panel still leaves the minimum.
    assert.equal(clampChatDockHeight(300, 100), CHAT_DOCK_MIN_HEIGHT);
  });
});

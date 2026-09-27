import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentOrbState, chatOrbState, voiceOrbState } from './agentStatusOrb';

describe('agent status orb mapping', () => {
  it('uses stream phases, the open tool and pending clarification', () => {
    assert.equal(chatOrbState('idle', null, false), null);
    assert.equal(chatOrbState('thinking', null, false), 'thinking');
    assert.equal(chatOrbState('writing', 'web_search', false), 'tool');
    assert.equal(chatOrbState('queued', null, false), 'waiting');
    assert.equal(chatOrbState('answered', null, true), 'waiting');
    assert.equal(chatOrbState('failed', null, false), 'error');
    assert.equal(chatOrbState('answered', null, false), 'done');
    assert.equal(voiceOrbState('tool', 'off'), 'thinking');
  });

  it('shows approval before a run, and runner degradation as error', () => {
    assert.equal(agentOrbState('running', 'online'), 'thinking');
    assert.equal(agentOrbState('waiting', 'online'), 'waiting');
    assert.equal(agentOrbState('ready', 'online'), 'idle');
    assert.equal(agentOrbState('running', 'degraded'), 'error');
    assert.equal(agentOrbState('waiting', 'degraded'), 'waiting');
  });

  it('maps chat and voice phases to the four Voice Orb states', () => {
    assert.equal(voiceOrbState('idle', 'off'), 'idle');
    assert.equal(voiceOrbState('done', 'off'), 'idle');
    assert.equal(voiceOrbState('waiting', 'off'), 'idle');
    assert.equal(voiceOrbState('error', 'off'), 'idle');
    assert.equal(voiceOrbState('idle', 'listening'), 'listening');
    assert.equal(voiceOrbState('idle', 'hearing'), 'listening');
    assert.equal(voiceOrbState('idle', 'transcribing'), 'thinking');
    assert.equal(voiceOrbState('idle', 'thinking'), 'thinking');
    assert.equal(voiceOrbState('idle', 'speaking'), 'speaking');
  });
});

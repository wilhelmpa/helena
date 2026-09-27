import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentOrbState, chatOrbState, shipnotesState } from './agentStatusOrb';

describe('agent status orb mapping', () => {
  it('uses stream phases, the open tool and pending clarification', () => {
    assert.equal(chatOrbState('idle', null, false), null);
    assert.equal(chatOrbState('thinking', null, false), 'thinking');
    assert.equal(chatOrbState('writing', 'web_search', false), 'tool');
    assert.equal(chatOrbState('queued', null, false), 'waiting');
    assert.equal(chatOrbState('answered', null, true), 'waiting');
    assert.equal(chatOrbState('failed', null, false), 'error');
    assert.equal(chatOrbState('answered', null, false), 'done');
    assert.equal(shipnotesState.tool, 'searching');
  });

  it('shows approval before a run, and runner degradation as error', () => {
    assert.equal(agentOrbState('running', 'online'), 'thinking');
    assert.equal(agentOrbState('waiting', 'online'), 'waiting');
    assert.equal(agentOrbState('ready', 'online'), 'idle');
    assert.equal(agentOrbState('running', 'degraded'), 'error');
    assert.equal(agentOrbState('waiting', 'degraded'), 'waiting');
  });
});

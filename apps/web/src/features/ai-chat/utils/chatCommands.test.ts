import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composerKeyAction } from './composerKeys';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
import {
  CHAT_COMMANDS,
  parseJevMode,
  composerSlashCommand,
  findCommand,
  fuzzyScore,
  parseSlashCommand,
  slashItems,
} from './chatCommands';

const prompt = (command: string, title: string) =>
  ({ id: 1, command, title, content: '', project: null }) as ChatPrompt;

describe('chat slash commands', () => {
  it('reads a command and its arguments, and leaves a path alone', () => {
    assert.deepEqual(parseSlashCommand('/model gpt-5.5 fast'), {
      name: 'model',
      args: 'gpt-5.5 fast',
    });
    assert.deepEqual(parseSlashCommand('/New'), { name: 'new', args: '' });
    assert.equal(parseSlashCommand('/Users/me/plan.md read this'), null);
    assert.equal(parseSlashCommand('model'), null);
    assert.equal(parseSlashCommand('/'), null);
  });

  it('maps the Hermes commands Plan carries out, and refuses the ones Plan controls', () => {
    assert.equal(findCommand('reset')?.action, 'new');
    assert.equal(findCommand('clear')?.action, 'new');
    assert.equal(findCommand('retry')?.action, 'retry');
    assert.equal(findCommand('undo')?.action, 'undo');
    assert.equal(findCommand('model')?.action, 'model');
    assert.equal(findCommand('reasoning')?.action, 'reasoning');
    assert.equal(findCommand('skills')?.action, 'skills');
    assert.equal(findCommand('memory')?.action, 'memory');
    assert.equal(findCommand('status')?.action, 'usage');
    assert.equal(findCommand('cron')?.refusal, 'schedules');
    assert.equal(findCommand('gateway')?.refusal, 'outside');
    assert.equal(findCommand('yolo')?.refusal, 'approvals');
    assert.equal(findCommand('personality')?.refusal, 'config');
    assert.equal(findCommand('compress'), undefined);
    for (const entry of CHAT_COMMANDS) assert.ok(!!entry.action !== !!entry.refusal, entry.name);
  });

  it('scores a start above a substring above letters in order', () => {
    assert.equal(fuzzyScore('mo', 'model'), 3);
    assert.equal(fuzzyScore('del', 'model'), 2);
    assert.equal(fuzzyScore('mdl', 'model'), 1);
    assert.equal(fuzzyScore('xyz', 'model'), -1);
  });

  it('offers prompts and commands, best first, and a refused command only when named', () => {
    const prompts = [prompt('release-notes', 'Release notes'), prompt('summary', 'Summarize')];
    const forRe = slashItems('re', prompts).map((item) =>
      item.kind === 'prompt' ? `prompt:${item.prompt.command}` : `command:${item.command.name}`,
    );
    assert.equal(forRe[0], 'prompt:release-notes');
    assert.ok(forRe.includes('command:retry'));
    assert.ok(forRe.includes('command:reasoning'));
    assert.ok(!forRe.includes('command:restart'));
    assert.ok(
      slashItems('', prompts).every((item) => item.kind === 'prompt' || !item.command.refusal),
    );
    assert.ok(
      slashItems('cron', prompts).some(
        (item) => item.kind === 'command' && item.command.name === 'cron',
      ),
    );
  });
});

describe('chat Jev command', () => {
  it('allows only bounded modes and does not parse prompt text as a setting', () => {
    assert.equal(findCommand('jev')?.action, 'jev');
    assert.equal(parseJevMode(' ON '), 'on');
    assert.equal(parseJevMode('off'), 'off');
    assert.equal(parseJevMode('inherit'), 'inherit');
    for (const text of ['', 'force', 'on do work', 'on\noff', '/jev on']) {
      assert.equal(parseJevMode(text), null);
    }
  });
  it('keeps Jev reachable during a running answer without enabling other busy commands', () => {
    assert.deepEqual(composerSlashCommand('/jev off', true), { name: 'jev', args: 'off' });
    assert.equal(composerSlashCommand('/model cheaper', true), null);
    assert.equal(composerSlashCommand('/new', true), null);
    assert.equal(composerSlashCommand('Please /jev off', false), null);
    assert.equal(composerSlashCommand('/jev/path', false), null);
    const items = slashItems('jev', [prompt('jev', 'A saved prompt')]);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'command');
    assert.equal(
      composerKeyAction(
        {
          key: 'Enter',
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          isComposing: false,
        },
        { menuOpen: true, busy: true, empty: false, canEditLast: false },
      ),
      'menu-pick',
    );
  });
});

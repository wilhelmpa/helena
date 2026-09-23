import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
import { CHAT_COMMANDS, findCommand, fuzzyScore, parseSlashCommand, slashItems } from './chatCommands';

const prompt = (command: string, title: string) =>
  ({ id: 1, command, title, content: '', project: null }) as ChatPrompt;

describe('chat slash commands', () => {
  it('reads a command and its arguments, and leaves a path alone', () => {
    assert.deepEqual(parseSlashCommand('/model gpt-5.5 fast'), { name: 'model', args: 'gpt-5.5 fast' });
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
    assert.ok(slashItems('', prompts).every((item) => item.kind === 'prompt' || !item.command.refusal));
    assert.ok(
      slashItems('cron', prompts).some(
        (item) => item.kind === 'command' && item.command.name === 'cron',
      ),
    );
  });
});

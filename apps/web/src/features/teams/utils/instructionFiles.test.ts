import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentRuntimeFile } from '@/lib/api/endpoints/agents';
import {
  extraFiles,
  instructionLabel,
  instructionPath,
  soulOf,
  withSoul,
} from './instructionFiles';

const file = (path: string, content = ''): AgentRuntimeFile => ({
  kind: 'instructions',
  path,
  content,
});

describe('instruction files', () => {
  it('reads and sets SOUL.md and drops it when it is emptied', () => {
    const files = [file('instructions/a.md', 'a')];
    assert.equal(soulOf(files), '');
    const set = withSoul(files, 'Ich bin ruhig.');
    assert.equal(soulOf(set), 'Ich bin ruhig.');
    assert.deepEqual(
      extraFiles(set).map((entry) => entry.path),
      ['instructions/a.md'],
    );
    assert.deepEqual(withSoul(set, '  '), files);
  });

  it('turns a typed name into a path the API accepts', () => {
    assert.equal(instructionPath('regeln'), 'instructions/regeln.md');
    assert.equal(instructionPath(' team/Regeln.md '), 'instructions/team/Regeln.md');
    assert.equal(instructionPath('instructions/x'), 'instructions/x.md');
    assert.equal(instructionPath(''), null);
    assert.equal(instructionPath('../x'), null);
    assert.equal(instructionPath('mit leerzeichen'), null);
  });

  it('shows a file by its short name', () => {
    assert.equal(instructionLabel('instructions/team/regeln.md'), 'team/regeln');
  });
});

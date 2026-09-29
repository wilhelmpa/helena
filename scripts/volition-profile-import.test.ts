import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProfile } from './volition-profile-import';

test('reads a closed Hermes SQLite snapshot and preserves memory, scripts, reasoning and tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'volition-import-'));
  try {
    await mkdir(join(root, 'memories'));
    await writeFile(join(root, 'memories', 'MEMORY.md'), 'Remember this exactly.\n');
    await mkdir(join(root, 'skills', 'learned', 'scripts'), { recursive: true });
    await writeFile(join(root, 'skills', 'learned', 'SKILL.md'), '# Learned\n');
    await writeFile(join(root, 'skills', 'learned', 'scripts', 'check.sh'), 'exit 0\n');
    const database = new Database(join(root, 'state.db'));
    database.run('CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, started_at REAL)');
    database.run(
      'CREATE TABLE messages (id INTEGER, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, reasoning TEXT, timestamp REAL)',
    );
    database.run("INSERT INTO sessions VALUES ('s1', 'tool', 'flash', 1)");
    database.run("INSERT INTO messages VALUES (1, 's1', 'assistant', '', ?, 'Consider this', 1)", [
      JSON.stringify([
        { id: 'c1', function: { name: 'terminal', arguments: '{"command":"pwd"}' } },
      ]),
    ]);
    database.close();
    const original = await readFile(join(root, 'state.db'));
    const mapping = { profile: root, sourceKey: 'fixture', teamId: 1, agentId: 1 };
    const result = await readProfile(mapping);
    expect(result.memory).toEqual([{ file: 'MEMORY.md', content: 'Remember this exactly.\n' }]);
    expect(result.skills[0]!.files).toEqual([{ path: 'scripts/check.sh', content: 'exit 0\n' }]);
    expect(result.sessions[0]!.items[0]!.content).toEqual([
      { type: 'reasoning', text: 'Consider this' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'terminal', input: { command: 'pwd' } },
    ]);
    expect(await readProfile(mapping)).toEqual(result);
    expect(await readFile(join(root, 'state.db'))).toEqual(original);
    await symlink('/etc', join(root, 'skills', 'escape'));
    await expect(readProfile(mapping)).rejects.toThrow('Symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

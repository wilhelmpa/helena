import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';

describe('knowledge preview routes', () => {
  beforeEach(async () => {
    await resetDb();
    await rm(process.env.PROJECT_VAULT_ROOT!, { recursive: true, force: true });
    await mkdir(process.env.PROJECT_VAULT_ROOT!, { recursive: true });
  });

  it('uses the same project and Private access rules as document reads', async () => {
    const owner = authedApi((await signUpTestUser()).cookie);
    await owner.projects.post({ key: 'MKT', name: 'Marketing' });
    await owner.projects.post({ key: 'OPS', name: 'Operations' });
    await owner.knowledge.notes.put({ path: 'Projects/MKT/Docs/Plan.md', content: '# MKT' });
    await owner.knowledge.notes.put({ path: 'Projects/OPS/Docs/Plan.md', content: '# OPS' });
    await owner.knowledge.notes.put({ path: 'Private/Diary.md', content: '# Private' });
    const member = await addProjectMember(owner, 'MKT');

    expect(
      (await member.knowledge.preview.get({ query: { path: 'Projects/MKT/Docs/Plan.md' } })).status,
    ).toBe(200);
    expect(
      (await member.knowledge.preview.get({ query: { path: 'Projects/OPS/Docs/Plan.md' } })).status,
    ).toBe(403);
    expect(
      (await member.knowledge.preview.get({ query: { path: 'Private/Diary.md' } })).status,
    ).toBe(403);
    expect(
      (await member.knowledge.preview.file.get({ query: { path: 'Private/Diary.md' } })).status,
    ).toBe(403);
    expect(
      (await owner.knowledge.preview.get({ query: { path: 'Private/Diary.md' } })).status,
    ).toBe(200);
  });
});

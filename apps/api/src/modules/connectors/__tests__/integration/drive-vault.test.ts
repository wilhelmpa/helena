import { beforeEach, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { aiAgent, db, helenaReceipt, project as projectTable, team } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { freshVault } from '#tests/helpers/vault';
import { makePdf } from '#modules/receipts/__tests__/pdf';
import { saveDriveToVault } from '../../google/drive-vault';
import type { ToolCaller } from '../../tools';

let caller: ToolCaller;
let vault: string;

beforeEach(async () => {
  await resetDb();
  vault = freshVault();
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'FAM', name: 'Familie' })).data!;
  await db.update(projectTable).set({ mcpEnabled: true }).where(eq(projectTable.id, project.id));
  await db.update(team).set({ mcpEnabled: true }).where(eq(team.id, project.teamId));
  const created = await createAgent(api, 'FAM', {
    name: 'Family agent',
    username: 'family-drive',
    kind: 'external',
    triggerOnMention: true,
  });
  expect(created.data?.agent).toBeDefined();
  const [agent] = await db.select().from(aiAgent).where(eq(aiAgent.username, 'family-drive'));
  caller = {
    agent: { id: agent!.id, userId: agent!.userId, teamId: project.teamId, name: 'Family agent' },
    project: { id: project.id, key: project.key },
    run: null,
  };
});

function input(bytes: string | Buffer, overrides: Record<string, unknown> = {}) {
  return {
    stream: Readable.from([Buffer.from(bytes)]),
    fileId: 'drive-123',
    name: 'Beleg.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-09-01T00:00:00Z',
    folder: 'Files',
    asReceipt: false,
    ...overrides,
  };
}

it('saves binary data once, checks project and Private boundaries, and enforces the streamed size limit', async () => {
  const first = await saveDriveToVault(caller, input('binary payload'));
  expect(first).toMatchObject({ vaultPath: 'Projects/FAM/Files/Beleg.pdf', duplicate: false });
  expect(existsSync(path.join(vault, first.vaultPath))).toBe(true);
  const second = await saveDriveToVault(caller, input('binary payload', { name: 'Other.pdf' }));
  expect(second).toMatchObject({ vaultPath: first.vaultPath, duplicate: true });
  await expect(
    saveDriveToVault(caller, input('x', { folder: 'Projects/OTHER/Files' })),
  ).rejects.toThrow('Another project');
  await expect(saveDriveToVault(caller, input('x', { folder: 'Private' }))).rejects.toThrow(
    'Private',
  );
  await expect(saveDriveToVault(caller, input(Buffer.alloc(50 * 1024 * 1024 + 1)))).rejects.toThrow(
    '50 MB',
  );
});

it('uses receipt date for the month folder and records Drive provenance without inventing amounts', async () => {
  const pdf = makePdf([
    'Stadtwerke Musterstadt GmbH',
    'Rechnung Nr. SW-2026-0042',
    'Rechnungsdatum: 05.08.2026',
  ]);
  const saved = await saveDriveToVault(
    caller,
    input(pdf, { asReceipt: true, modifiedTime: '2026-09-01T00:00:00Z' }),
  );
  expect(saved.vaultPath.startsWith('Projects/FAM/Files/Belege/2026-08/')).toBe(true);
  const [receipt] = await db
    .select()
    .from(helenaReceipt)
    .where(eq(helenaReceipt.projectId, caller.project.id));
  expect(receipt!.details).toMatchObject({ driveSource: 'Google Drive drive-123' });
  expect(receipt!.totalGross).toBeNull();
  const duplicate = await saveDriveToVault(caller, input(pdf, { asReceipt: true }));
  expect(duplicate).toMatchObject({ duplicate: true, receiptId: receipt!.id });
  const undated = await saveDriveToVault(
    caller,
    input(makePdf(['Unlesbarer Beleg']), {
      asReceipt: true,
      name: 'OhneDatum.pdf',
      modifiedTime: '2026-09-12T00:00:00Z',
    }),
  );
  expect(undated.vaultPath.startsWith('Projects/FAM/Files/Belege/2026-09/')).toBe(true);
});

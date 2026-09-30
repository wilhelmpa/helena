import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

const root = new URL('../../messages/', import.meta.url);
const locales = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function messages(locale: string, namespace: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`${locale}/${namespace}.json`, root), 'utf8'));
}

function strings(value: unknown, path: string): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`));
}

const germanExceptions: Record<string, string> = {
  'nav.inbox': 'Mail inbox, not the owner action collection.',
  'nav.approvals': 'Legacy approval history route.',
  'inbox.title': 'Mail inbox page.',
  'inbox.backToList': 'Mail inbox navigation.',
  'inbox.hub.mailLoading': 'Mail inbox loading state.',
  'inbox.groups.approvals': 'Approval item type within the Inbox.',
  'chatWorkspace.composer.refusal.approvals': 'Approval is an action in this explanation.',
  'chatWorkspace.session.copy': 'CLI session identifier used for resuming.',
  'chatWorkspace.session.copied': 'CLI session identifier used for resuming.',
  'files.unified.run': 'The ICU variable {run} is an internal parameter.',
};

describe('Helena language on main surfaces', () => {
  for (const locale of locales) {
    it(`${locale} uses one name for Knowledge and has no empty-chat explanation`, () => {
      const nav = messages(locale, 'nav');
      const workspace = nav.workspace as Record<string, string>;
      const home = messages(locale, 'homeChat');
      const chat = messages(locale, 'chatWorkspace');
      const newChat = chat.newChat as Record<string, string>;
      assert.equal(nav.documents, nav.sidebarKnowledge);
      assert.equal(nav.docs, nav.sidebarKnowledge);
      assert.equal(nav.files, nav.sidebarKnowledge);
      assert.equal(nav.aiAgents, nav.organization);
      assert.equal(messages(locale, 'organization').title, nav.organization);
      assert.equal(workspace.notes, nav.sidebarKnowledge);
      assert.equal('hint' in home, false);
      assert.equal('hint' in newChat, false);
      for (const [path, value] of [
        ['messages.noteSaved', (chat.messages as Record<string, string>).noteSaved],
        ['composer.fromVault', (chat.composer as Record<string, string>).fromVault],
        ['composer.vaultRoot', (chat.composer as Record<string, string>).vaultRoot],
        ['artifact.save', (chat.artifact as Record<string, string>).save],
        [
          'files.actions.openInDocs',
          (messages(locale, 'files').actions as Record<string, string>).openInDocs,
        ],
      ] as const) {
        assert.doesNotMatch(value, /\b(?:Docs|Vault)\b/i, `${locale}: ${path}`);
      }
    });
  }

  it('rejects German glossary violations and live status sentences on main surfaces', () => {
    const forbidden =
      /\b(?:Ticket|Issue|Task|Posteingang|Freigaben|Docs|Vault|Notizen|Runtime|Adapter|Laufzeit|Bot|Assistent|Routine|Cron|Schedule|Run|Session|Approval|Organisation|Start)\b|(?:denkt nach|nutzt Werkzeug|Antwort wird erstellt|schreibt …|wartet …)/i;
    for (const namespace of ['homeChat', 'nav', 'inbox', 'chatWorkspace', 'files']) {
      for (const [path, value] of strings(messages('de', namespace), namespace)) {
        if (germanExceptions[path]) continue;
        assert.doesNotMatch(value, forbidden, path);
      }
    }
  });

  it('calls initiatives "Ziele" in every German namespace', () => {
    for (const file of readdirSync(new URL('de/', root))) {
      if (!file.endsWith('.json')) continue;
      const namespace = file.slice(0, -'.json'.length);
      for (const [path, value] of strings(messages('de', namespace), namespace)) {
        assert.doesNotMatch(value, /Initiativ/i, path);
      }
    }
  });
});

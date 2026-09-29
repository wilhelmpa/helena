import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadMessages } from './messages';
import { DEFAULT_LOCALE, LOCALES } from './locales';
import { composeDocumentTitle } from '@/hooks/useDocumentTitle';

describe('display name', () => {
  it('uses the stored name in messages and titles and keeps the default', async () => {
    const renamed = await loadMessages(DEFAULT_LOCALE, 'Atlas');
    const standard = await loadMessages(DEFAULT_LOCALE);
    assert.match(renamed.meta.title, /^Atlas/);
    assert.match(renamed.nav.basedOn, /^Atlas is a fork/);
    assert.match(renamed.nav.dockContext, /^ATLAS/);
    assert.match(standard.meta.title, /^Helena/);
    assert.equal(composeDocumentTitle(['Settings'], null, 'Atlas'), 'Settings · Atlas');
  });

  it('keeps literal product names out of translated values', () => {
    const root = new URL('../../messages/', import.meta.url);
    for (const locale of readdirSync(root, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    )) {
      const folder = new URL(`${locale.name}/`, root);
      for (const file of readdirSync(folder).filter((name) => name.endsWith('.json'))) {
        const json = JSON.parse(readFileSync(new URL(file, folder), 'utf8'));
        const visit = (value: unknown): void => {
          if (typeof value === 'string') assert.doesNotMatch(value, /Helena|هيلينا/);
          else if (value && typeof value === 'object') Object.values(value).forEach(visit);
        };
        visit(json);
      }
    }
  });

  it('substitutes the name in every locale', async () => {
    for (const locale of LOCALES) {
      const messages = await loadMessages(locale, 'Atlas');
      assert.match(messages.meta.title, /Atlas/);
      assert.match(messages.nav.basedOn, /Atlas/);
    }
  });

  it('keeps fixed product text out of JSX copy', () => {
    const root = new URL('../', import.meta.url);
    const visit = (folder: URL): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
        if (entry.isDirectory()) visit(child);
        else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
          const source = readFileSync(child, 'utf8');
          assert.doesNotMatch(source, />\s*Helena\s*</);
          assert.doesNotMatch(source, /(?:placeholder|title|aria-label)="[^"]*Helena[^"]*"/);
        }
      }
    };
    visit(root);
  });

  it('keeps fixed product text out of mail templates', () => {
    for (const path of [
      '../../../../packages/brand/src/mail.ts',
      '../../../../packages/mailer/src/index.ts',
      '../../../../packages/auth/src/mail.ts',
      '../../../../apps/worker/src/notification-send.ts',
      '../../../api/src/modules/invites/email.ts',
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /['"`]([^'"`]*Helena[^'"`]*)['"`]/);
    }
  });
});

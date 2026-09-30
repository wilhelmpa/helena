import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { CatalogFinding } from '@/lib/api/endpoints/catalog';
import catalog from '../../../../messages/de/catalog.json';
import { FindingList, VerdictNotice } from './FindingsView';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" timeZone="Europe/Berlin" messages={{ catalog }}>
      {node}
    </NextIntlClientProvider>,
  );
const finding = (over: Partial<CatalogFinding>): CatalogFinding => ({
  code: 'executable',
  severity: 'review',
  path: 'scripts/run.sh',
  detail: 'Executable script; catalog import excludes it',
  ...over,
});

describe('inspection findings in plain language', () => {
  it('says what the verdict allows', () => {
    assert.match(wrap(<VerdictNotice findings={[]} />), /Keine Auffälligkeiten/);
    assert.match(wrap(<VerdictNotice findings={[finding({})]} />), /nur mit deiner Bestätigung/);
    assert.match(
      wrap(<VerdictNotice findings={[finding({ severity: 'block', code: 'license' })]} />),
      /kann nicht übernommen werden/,
    );
  });

  it('explains every finding in a sentence with its file, not with the English API text', () => {
    const html = wrap(
      <FindingList
        kind="github-skills"
        license={null}
        findings={[
          finding({}),
          finding({ code: 'license', severity: 'block', path: '', detail: 'License unknown' }),
          finding({
            code: 'secret',
            severity: 'block',
            path: 'SKILL.md',
            detail: 'Possible credential',
          }),
        ]}
      />,
    );
    assert.match(html, /Beim Übernehmen wird es nicht mit importiert/);
    assert.match(html, /Die Lizenz „unbekannt“ ist nicht als mit AGPL-3.0 vereinbar bestätigt/);
    assert.match(html, /vermutlich ein Passwort oder einen Schlüssel/);
    assert.match(html, /scripts\/run\.sh/);
    assert.doesNotMatch(html, /Executable script|Possible credential|License unknown/);
    // blocked before review
    assert.ok(html.indexOf('Blockiert') < html.indexOf('Zur Prüfung'));
  });

  it('counts unpinned dependencies from the API text and words a script of an MCP package differently', () => {
    const html = wrap(
      <FindingList
        kind="npm-mcp"
        license="MIT"
        findings={[
          finding({
            code: 'unscanned-dependencies',
            severity: 'block',
            path: '',
            detail: '3 runtime dependencies are not pinned and inspected',
          }),
          finding({}),
        ]}
      />,
    );
    assert.match(html, /3 Abhängigkeiten mit, die weder festgelegt noch geprüft sind/);
    assert.match(html, /Enthält ausführbaren Code oder ein Skript, das beim Installieren läuft/);
    assert.doesNotMatch(html, /nicht mit importiert/);
  });
});

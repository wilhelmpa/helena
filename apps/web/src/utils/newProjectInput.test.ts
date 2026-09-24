import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { presetIssueTypes } from '@helena/locales/defaults';
import { newProjectInput } from './newProjectInput';

const fields = {
  key: ' mkt ',
  name: ' Marketing ',
  description: ' Campaigns ',
  locale: 'de' as const,
  preset: 'software' as const,
  include: null,
};

describe('newProjectInput', () => {
  it('sends the preset and the language the preview was shown in', () => {
    assert.deepEqual(newProjectInput(fields), {
      key: 'MKT',
      name: 'Marketing',
      description: 'Campaigns',
      locale: 'de',
      preset: 'software',
    });
  });

  it('sends the selection of sections instead of a preset for a copy', () => {
    const include = {
      states: false,
      issueTypes: true,
      labels: true,
      customFields: true,
      views: false,
      dashboards: false,
      documents: false,
      actions: false,
      configuration: false,
      webhooks: false,
    };
    const input = newProjectInput({ ...fields, include });
    assert.equal(input.preset, undefined);
    assert.deepEqual(input.include, include);
    assert.equal(input.locale, 'de');
  });

  it('previews the names the project is created with in the language it sends', () => {
    // The dialog lists presetIssueTypes(preset, locale) and sends the same locale; the
    // API creates presetIssueTypes(preset, locale) from the same catalog.
    assert.deepEqual(
      presetIssueTypes('software', 'de').map((type) => type.name),
      ['Feature', 'Bug', 'Aufgabe', 'Technische Schulden', 'Recherche'],
    );
    assert.deepEqual(
      presetIssueTypes('general', 'en').map((type) => type.name),
      ['Task'],
    );
  });
});

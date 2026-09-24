import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeDocumentTitle } from './useDocumentTitle';

describe('composeDocumentTitle', () => {
  it('lists the crumbs most specific first and ends with the app', () => {
    assert.equal(
      composeDocumentTitle(['Labels', 'Einstellungen', 'E2E']),
      'Labels · Einstellungen · E2E · Helena',
    );
  });
  it('puts a lead before the project and drops the other crumbs', () => {
    assert.equal(
      composeDocumentTitle(['E2E-4', 'E2E'], 'E2E-4 QA Aufgabe 2'),
      'E2E-4 QA Aufgabe 2 · E2E · Helena',
    );
  });
  it('names only the app without any words', () => {
    assert.equal(composeDocumentTitle([]), 'Helena');
  });
});

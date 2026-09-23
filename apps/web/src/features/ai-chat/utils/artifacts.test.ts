import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARTIFACT_SANDBOX,
  artifactDocument,
  artifactFileName,
  extractArtifacts,
  isArtifactLanguage,
  splitArtifacts,
} from './artifacts';

describe('artifacts', () => {
  it('runs a preview with scripts but without the origin of Plan', () => {
    const flags = ARTIFACT_SANDBOX.split(' ');
    assert.ok(flags.includes('allow-scripts'));
    for (const flag of [
      'allow-same-origin',
      'allow-top-navigation',
      'allow-forms',
      'allow-popups',
      'allow-downloads',
    ]) {
      assert.ok(!flags.includes(flag), flag);
    }
  });

  it('keeps a preview off the network with a policy of its own', () => {
    const page = artifactDocument({
      language: 'html',
      code: '<h1>Hi</h1><script>fetch("/x")</script>',
    });
    assert.match(
      page,
      /http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'/,
    );
    assert.ok(!/connect-src/.test(page));
    const withHead = artifactDocument({
      language: 'html',
      code: '<html><head><title>T</title></head><body>x</body></html>',
    });
    assert.match(
      withHead,
      /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/,
    );
    const svg = artifactDocument({ language: 'svg', code: '<svg viewBox="0 0 1 1"></svg>' });
    assert.match(svg, /<body><svg viewBox="0 0 1 1"><\/svg><\/body>/);
  });

  it('knows which code blocks it previews, and names the saved file', () => {
    assert.ok(isArtifactLanguage('HTML'));
    assert.ok(isArtifactLanguage('svg'));
    assert.ok(!isArtifactLanguage('js'));
    assert.equal(
      artifactFileName('html', 'Landing: page / v2', new Date('2026-09-23T14:05:00Z')),
      'Landing page v2 20260923-1405.html',
    );
  });

  it('finds the html and svg fences of an answer, tagged or not', () => {
    const text = [
      'Here is a page:',
      '```html',
      '<h1>Hi</h1>',
      '```',
      'and an icon:',
      '```svg',
      '<svg></svg>',
      '```',
      'and some data, which is not an artifact:',
      '```json',
      '{"a":1}',
      '```',
    ].join('\n');
    const artifacts = extractArtifacts(text);
    assert.equal(artifacts.length, 2);
    assert.deepEqual(artifacts[0], { language: 'html', code: '<h1>Hi</h1>' });
    assert.deepEqual(artifacts[1], { language: 'svg', code: '<svg></svg>' });
  });

  it('takes the fences out of the prose an artifact card replaces them with', () => {
    const { text, artifacts } = splitArtifacts('Before.\n```html\n<p>x</p>\n```\nAfter.');
    assert.equal(artifacts.length, 1);
    assert.equal(text, 'Before.\n\nAfter.');
  });

  it('leaves plain prose with no fence untouched', () => {
    const { text, artifacts } = splitArtifacts('Just an answer, no code.');
    assert.equal(artifacts.length, 0);
    assert.equal(text, 'Just an answer, no code.');
  });
});

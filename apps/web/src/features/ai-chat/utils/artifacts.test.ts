import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARTIFACT_SANDBOX,
  artifactDocument,
  artifactFileName,
  isArtifactLanguage,
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
});

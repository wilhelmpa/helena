import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mailFrameDocument } from './mailHtml';

describe('mailFrameDocument', () => {
  it('loads images from the api only until remote images are allowed', () => {
    const blocked = mailFrameDocument({
      html: '<p>Hi</p>',
      apiBase: 'https://api.example/',
      allowRemoteImages: false,
    });
    assert.match(blocked, /img-src data: https:\/\/api\.example;/);
    assert.match(blocked, /<base href="https:\/\/api\.example\/" target="_blank">/);
    assert.match(blocked, /<body><p>Hi<\/p><\/body>/);
    const allowed = mailFrameDocument({
      html: '',
      apiBase: 'https://api.example/',
      allowRemoteImages: true,
    });
    assert.match(allowed, /img-src data: https:\/\/api\.example https: http:;/);
  });

  it('turns a message written for a white page into the dark surface of the app', () => {
    const light = mailFrameDocument({
      html: '<p>Hi</p>',
      apiBase: 'https://api.example/',
      allowRemoteImages: false,
    });
    assert.doesNotMatch(light, /invert/);
    const dark = mailFrameDocument({
      html: '<p>Hi</p>',
      apiBase: 'https://api.example/',
      allowRemoteImages: false,
      dark: true,
      surface: '#141218',
    });
    // colours inverted, the app's surface under it, photos turned back
    assert.match(dark, /background:#141218/);
    assert.match(dark, /body\{[^}]*filter:invert\(1\) hue-rotate\(180deg\)/);
    assert.match(dark, /mix-blend-mode:lighten/);
    assert.match(dark, /img,video,picture,svg[^{]*\{filter:invert\(1\) hue-rotate\(180deg\)\}/);
  });

  it('takes only a plain colour as the surface', () => {
    const dark = mailFrameDocument({
      html: '',
      apiBase: 'https://api.example/',
      allowRemoteImages: false,
      dark: true,
      surface: 'red;}</style><script>alert(1)</script>',
    });
    assert.doesNotMatch(dark, /<script>/);
    // the dark surface token (--surface-1) stands in for anything that is not a colour
    assert.match(dark, /background:#1a1820/);
  });
});

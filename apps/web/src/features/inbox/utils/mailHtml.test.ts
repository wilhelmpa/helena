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
});

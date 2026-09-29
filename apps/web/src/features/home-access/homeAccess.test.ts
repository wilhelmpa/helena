import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { homeTarget, isHomeAnswer, probeUrl, shouldProbe, isHomeOrigin } from './homeAccess';
import { passkeysUsableOn } from './passkeys';

const HOME = 'https://helena-home.example.com';
const PUBLIC = 'https://helena.example.com';
const now = 1_000_000;

describe('at home, the fast way', () => {
  it('asks only from another origin, with a home origin over https, and not while paused', () => {
    const base = { here: PUBLIC, homeUrl: HOME, failedUntil: null, stay: false, now };
    assert.equal(shouldProbe(base), true);
    // The home origin never sends anyone away: no loop.
    assert.equal(shouldProbe({ ...base, here: HOME }), false);
    assert.equal(shouldProbe({ ...base, homeUrl: undefined }), false);
    assert.equal(shouldProbe({ ...base, homeUrl: 'http://helena-home.example.com' }), false);
    assert.equal(shouldProbe({ ...base, homeUrl: 'not a url' }), false);
    assert.equal(shouldProbe({ ...base, stay: true }), false);
    assert.equal(shouldProbe({ ...base, failedUntil: now + 1 }), false);
    assert.equal(shouldProbe({ ...base, failedUntil: now - 1 }), true);
    // Public share pages are for other people.
    assert.equal(shouldProbe({ ...base, pathname: '/share/abc' }), false);
    assert.equal(shouldProbe({ ...base, pathname: '/project/VOL' }), true);
  });

  it('asks the home origin’s own probe', () => {
    assert.equal(probeUrl(`${HOME}/`), `${HOME}/backend/edge/home/probe`);
  });

  it('continues on the same page, without the stay parameter', () => {
    assert.equal(
      homeTarget(HOME, { pathname: '/project/VOL', search: '?view=board&remote=1', hash: '#c' }),
      `${HOME}/project/VOL?view=board#c`,
    );
    assert.equal(homeTarget(HOME, { pathname: '/', search: '', hash: '' }), `${HOME}/`);
  });

  it('trusts only Helena’s answer for the home name', () => {
    assert.equal(isHomeAnswer({ home: true, host: 'helena-home.example.com' }, HOME), true);
    assert.equal(isHomeAnswer({ home: false, host: 'helena-home.example.com' }, HOME), false);
    assert.equal(isHomeAnswer({ home: true, host: 'router.local' }, HOME), false);
    assert.equal(isHomeAnswer('<html>', HOME), false);
    assert.equal(isHomeAnswer(null, HOME), false);
  });
});

describe('passkeys on the home origin', () => {
  it('work on the name they are bound to and below it only', () => {
    assert.equal(passkeysUsableOn('helena.example.com', 'helena.example.com'), true);
    assert.equal(passkeysUsableOn('helena.example.com', 'a.helena.example.com'), true);
    assert.equal(passkeysUsableOn('helena.example.com', 'helena-home.example.com'), false);
    assert.equal(passkeysUsableOn('helena.example.com', 'evilhelena.example.com'), false);
    assert.equal(passkeysUsableOn(undefined, 'anything.test'), true);
  });
});

it('the LAN expiry check runs only on the home origin (29.09.)', () => {
  assert.equal(isHomeOrigin('https://helena-home.example', 'https://helena-home.example/'), true);
  assert.equal(isHomeOrigin('https://helena.example', 'https://helena-home.example/'), false);
  assert.equal(isHomeOrigin('https://helena.example', undefined), false);
});

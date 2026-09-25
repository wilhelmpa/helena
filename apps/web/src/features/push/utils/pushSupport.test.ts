import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAppleMobile, pushSupport, type PushEnvironment } from './pushSupport';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

function env(over: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    isSecureContext: true,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: 'default',
    userAgent: ANDROID,
    maxTouchPoints: 5,
    standalone: false,
    ...over,
  };
}

describe('pushSupport', () => {
  it('works on a current browser over https', () => {
    assert.equal(pushSupport(env()), 'supported');
  });

  it('asks for https on plain http first, whatever the browser', () => {
    assert.equal(pushSupport(env({ isSecureContext: false })), 'insecure');
    assert.equal(pushSupport(env({ isSecureContext: false, userAgent: IPHONE })), 'insecure');
  });

  it('asks an iPhone or iPad in a Safari tab to add Helena to the home screen', () => {
    assert.equal(pushSupport(env({ userAgent: IPHONE, hasPushManager: false })), 'ios-install');
    assert.equal(pushSupport(env({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })), 'ios-install');
    assert.equal(pushSupport(env({ userAgent: IPHONE, standalone: true })), 'supported');
  });

  it('says so where the browser has no push, and when notifications are blocked', () => {
    assert.equal(pushSupport(env({ hasPushManager: false })), 'unsupported');
    assert.equal(pushSupport(env({ hasServiceWorker: false })), 'unsupported');
    assert.equal(pushSupport(env({ permission: 'denied' })), 'denied');
  });

  it('tells a Mac from an iPad that says it is one', () => {
    assert.equal(isAppleMobile(IPAD_AS_MAC, 0), false);
    assert.equal(isAppleMobile(IPAD_AS_MAC, 5), true);
    assert.equal(isAppleMobile(IPHONE, 5), true);
  });
});

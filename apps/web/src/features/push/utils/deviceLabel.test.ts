import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviceLabel, pushServiceOf } from './deviceLabel';

describe('deviceLabel', () => {
  it('names the platform and the browser', () => {
    assert.equal(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
      ),
      'iPhone · Safari',
    );
    assert.equal(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
      'Mac · Chrome',
    );
    assert.equal(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      ),
      'Android · Chrome',
    );
    assert.equal(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      ),
      'Windows · Edge',
    );
    assert.equal(
      deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0'),
      'Linux · Firefox',
    );
    assert.equal(deviceLabel(''), '');
  });

  it('knows the big push services by their host', () => {
    assert.equal(pushServiceOf('web.push.apple.com'), 'apple');
    assert.equal(pushServiceOf('fcm.googleapis.com'), 'google');
    assert.equal(pushServiceOf('updates.push.services.mozilla.com'), 'mozilla');
    assert.equal(pushServiceOf('wns2-par02p.notify.windows.com'), 'microsoft');
    assert.equal(pushServiceOf('push.example.org'), 'other');
  });
});

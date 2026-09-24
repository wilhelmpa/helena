import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clickCount,
  frameRect,
  heldButton,
  keyMessage,
  modifiers,
  mouseButton,
  pagePoint,
  readFrame,
  screencastUrl,
  textMessages,
  wheelDelta,
  type KeyInput,
} from './browserLive';

function key(overrides: Partial<KeyInput>): KeyInput {
  return {
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    location: 0,
    repeat: false,
    isComposing: false,
    altGraph: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('live view frames', () => {
  it('opens the WebSocket next to the control routes', () => {
    assert.equal(
      screencastUrl('https://plan.example.com/browser/projects/demo/api'),
      'wss://plan.example.com/browser/projects/demo/api/screencast',
    );
    assert.equal(
      screencastUrl('http://kingston-server.local/browser/projects/demo/api'),
      'ws://kingston-server.local/browser/projects/demo/api/screencast',
    );
  });

  it('reads the viewport in CSS pixels in front of the JPEG', async () => {
    const data = new Uint8Array([0, 0x03, 0x20, 0x02, 0x01, 0xff, 0xd8]).buffer;
    const { size, jpeg } = readFrame(data);
    assert.deepEqual(size, { width: 800, height: 513 });
    assert.equal(jpeg.type, 'image/jpeg');
    assert.deepEqual([...new Uint8Array(await jpeg.arrayBuffer())], [0xff, 0xd8]);
  });
});

describe('live view coordinates', () => {
  it('draws a page of the view size one to one and maps a point to the same page point', () => {
    const size = { width: 800, height: 600 };
    const rect = frameRect(size, size);
    assert.deepEqual(rect, { left: 0, top: 0, width: 800, height: 600 });
    assert.deepEqual(pagePoint({ x: 120.5, y: 40 }, rect, size), { x: 120.5, y: 40 });
  });

  it('draws a page a pixel or two off the view size one to one, not stretched', () => {
    // A page at ratio 1 is made even: a 619 pixel wide view shows a 620 pixel wide page with
    // its last column cut off.
    const rect = frameRect({ width: 619, height: 612 }, { width: 620, height: 612 });
    assert.deepEqual(rect, { left: 0, top: 0, width: 620, height: 612 });
    assert.deepEqual(pagePoint({ x: 618.5, y: 611.5 }, rect, { width: 620, height: 612 }), {
      x: 618.5,
      y: 611.5,
    });
  });

  it('maps through the scale and the bands of a frame drawn smaller than the view', () => {
    // Chromium keeps a window at least 500 pixels wide, so a narrower view shows the page
    // scaled down.
    const box = { width: 250, height: 600 };
    const frame = { width: 500, height: 400 };
    const rect = frameRect(box, frame);
    assert.deepEqual(rect, { left: 0, top: 200, width: 250, height: 200 });
    assert.deepEqual(pagePoint({ x: 125, y: 300 }, rect, frame), { x: 250, y: 200 });
    assert.deepEqual(pagePoint({ x: 25, y: 220 }, rect, frame), { x: 50, y: 40 });
    // A point in a band above or below the frame lands on its edge.
    assert.deepEqual(pagePoint({ x: -10, y: 10 }, rect, frame), { x: 0, y: 0 });
    assert.deepEqual(pagePoint({ x: 300, y: 590 }, rect, frame), { x: 500, y: 400 });
  });

  it('centres a frame that is wider than the view is tall, in whole pixels', () => {
    const rect = frameRect({ width: 1000, height: 500 }, { width: 800, height: 800 });
    assert.deepEqual(rect, { left: 250, top: 0, width: 500, height: 500 });
    assert.deepEqual(pagePoint({ x: 500, y: 250 }, rect, { width: 800, height: 800 }), {
      x: 400,
      y: 400,
    });
    // A fixed working size (1440x900) in a 619x612 panel.
    assert.deepEqual(frameRect({ width: 619, height: 612 }, { width: 1440, height: 900 }), {
      left: 0,
      top: 113,
      width: 619,
      height: 387,
    });
  });

  it('maps into the page zoom, which makes the CSS size smaller than the drawn page', () => {
    // A 1280x800 page at 125 % zoom is 1024x640 CSS pixels.
    const rect = frameRect({ width: 1280, height: 800 }, { width: 1280, height: 800 });
    assert.deepEqual(pagePoint({ x: 640, y: 400 }, rect, { width: 1024, height: 640 }), {
      x: 512,
      y: 320,
    });
  });
});

describe('live view mouse', () => {
  it('names the buttons as DevTools does', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 7].map(mouseButton), [
      'left',
      'middle',
      'right',
      'back',
      'forward',
      'none',
    ]);
    assert.equal(heldButton(1), 'left');
    assert.equal(heldButton(2), 'right');
    assert.equal(heldButton(4), 'middle');
    assert.equal(heldButton(0), 'none');
  });

  it('counts double and triple clicks of one button at one place', () => {
    const first = { x: 10, y: 10, time: 1_000, button: 0, count: 1 };
    assert.equal(clickCount(null, first), 1);
    assert.equal(clickCount(first, { x: 12, y: 9, time: 1_300, button: 0 }), 2);
    assert.equal(clickCount({ ...first, count: 2 }, { x: 10, y: 10, time: 1_300, button: 0 }), 3);
    assert.equal(clickCount({ ...first, count: 3 }, { x: 10, y: 10, time: 1_300, button: 0 }), 3);
    assert.equal(clickCount(first, { x: 10, y: 10, time: 1_600, button: 0 }), 1);
    assert.equal(clickCount(first, { x: 20, y: 10, time: 1_100, button: 0 }), 1);
    assert.equal(clickCount(first, { x: 10, y: 10, time: 1_100, button: 2 }), 1);
  });

  it('turns line and page scrolling into pixels', () => {
    assert.deepEqual(wheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 600), {
      deltaX: 0,
      deltaY: 120,
    });
    assert.deepEqual(wheelDelta({ deltaX: 1, deltaY: 0, deltaMode: 2 }, 600), {
      deltaX: 600,
      deltaY: 0,
    });
    assert.deepEqual(wheelDelta({ deltaX: 4, deltaY: -53, deltaMode: 0 }, 600), {
      deltaX: 4,
      deltaY: -53,
    });
  });
});

describe('live view keys', () => {
  it('sends Command from a Mac as Control, which the Linux browser uses', () => {
    const shortcut = { altKey: false, ctrlKey: false, metaKey: true, shiftKey: true };
    assert.equal(modifiers(shortcut, true), 2 | 8);
    assert.equal(modifiers(shortcut, false), 4 | 8);
    assert.equal(modifiers({ ...shortcut, metaKey: false, altKey: true }, false), 1 | 8);
    assert.deepEqual(
      keyMessage(key({ key: 'Meta', code: 'MetaLeft', keyCode: 91, metaKey: true }), 'down', true),
      {
        type: 'key',
        event: 'down',
        key: 'Control',
        code: 'ControlLeft',
        keyCode: 17,
        location: 0,
        autoRepeat: false,
        modifiers: 2,
      },
    );
    const selectAll = keyMessage(key({ metaKey: true }), 'down', true);
    assert.equal(selectAll?.modifiers, 2);
    assert.equal(selectAll?.text, undefined);
  });

  it('sends the text of a typed key with the key down only', () => {
    assert.equal(keyMessage(key({}), 'down', false)?.text, 'a');
    assert.equal(keyMessage(key({ key: 'A', shiftKey: true }), 'down', false)?.text, 'A');
    assert.equal(
      keyMessage(key({ key: ' ', code: 'Space', keyCode: 32 }), 'down', false)?.text,
      ' ',
    );
    assert.equal(keyMessage(key({}), 'up', false)?.text, undefined);
    assert.equal(keyMessage(key({ ctrlKey: true }), 'down', false)?.text, undefined);
  });

  it('sends Enter with a carriage return and editing keys without text', () => {
    const enter = keyMessage(key({ key: 'Enter', code: 'Enter', keyCode: 13 }), 'down', false);
    assert.equal(enter?.text, '\r');
    for (const [name, keyCode] of [
      ['Backspace', 8],
      ['Tab', 9],
      ['ArrowLeft', 37],
      ['Delete', 46],
      ['Escape', 27],
    ] as const) {
      const message = keyMessage(key({ key: name, code: name, keyCode }), 'down', false);
      assert.equal(message?.key, name);
      assert.equal(message?.keyCode, keyCode);
      assert.equal(message?.text, undefined);
    }
    assert.equal(
      keyMessage(key({ key: '1', code: 'Numpad1', keyCode: 97, location: 3 }), 'down', false)
        ?.location,
      3,
    );
  });

  it('types the characters of Option on a Mac and AltGr elsewhere', () => {
    const macAt = keyMessage(
      key({ key: '@', code: 'KeyL', keyCode: 76, altKey: true }),
      'down',
      true,
    );
    assert.equal(macAt?.text, '@');
    assert.equal(macAt?.modifiers, 0);
    const altGrAt = keyMessage(
      key({ key: '@', code: 'KeyQ', keyCode: 81, altKey: true, ctrlKey: true, altGraph: true }),
      'down',
      false,
    );
    assert.equal(altGrAt?.text, '@');
    assert.equal(altGrAt?.modifiers, 0);
    const altShortcut = keyMessage(
      key({ key: 'f', code: 'KeyF', keyCode: 70, altKey: true }),
      'down',
      false,
    );
    assert.equal(altShortcut?.modifiers, 1);
  });

  it('sends pasted text in pieces the router accepts, without splitting a character', () => {
    assert.deepEqual(textMessages(''), []);
    assert.deepEqual(textMessages('ü 😀'), [{ type: 'text', text: 'ü 😀' }]);
    const long = textMessages('😀'.repeat(20_000));
    assert.equal(long.length, 2);
    assert.ok(long.every((message) => message.type === 'text' && message.text.length <= 64 * 1024));
    assert.equal(
      long.map((message) => (message.type === 'text' ? message.text : '')).join(''),
      '😀'.repeat(20_000),
    );
  });

  it('leaves composition keys and the paste shortcut to the text field', () => {
    assert.equal(keyMessage(key({ isComposing: true }), 'down', false), null);
    assert.equal(keyMessage(key({ key: 'Process', keyCode: 229 }), 'down', false), null);
    assert.equal(
      keyMessage(key({ key: 'Dead', code: 'Quote', keyCode: 222 }), 'down', false),
      null,
    );
    const pasteKey = { code: 'KeyV', keyCode: 86 };
    assert.equal(keyMessage(key({ key: 'v', ...pasteKey, ctrlKey: true }), 'down', false), null);
    assert.equal(keyMessage(key({ key: 'v', ...pasteKey, metaKey: true }), 'down', true), null);
    assert.equal(
      keyMessage(key({ key: 'V', ...pasteKey, ctrlKey: true, shiftKey: true }), 'down', false),
      null,
    );
    // Control+V on a Russian layout gives the key м.
    assert.equal(keyMessage(key({ key: 'м', ...pasteKey, ctrlKey: true }), 'down', false), null);
    assert.equal(
      keyMessage(
        key({ key: 'Insert', code: 'Insert', keyCode: 45, shiftKey: true }),
        'down',
        false,
      ),
      null,
    );
    assert.equal(
      keyMessage(key({ key: 'Insert', code: 'Insert', keyCode: 45 }), 'down', false)?.key,
      'Insert',
    );
    assert.equal(keyMessage(key({ key: 'v', ...pasteKey }), 'down', false)?.text, 'v');
    assert.equal(
      keyMessage(key({ key: 'c', code: 'KeyC', metaKey: true }), 'down', true)?.modifiers,
      2,
    );
  });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseMessage, snippetOf, threadKeyOf, findInlinePart } from '../parse';

const fixture = (name: string) => readFileSync(path.join(import.meta.dir, 'fixtures', name));

function mime(parts: string): Buffer {
  return Buffer.from(
    [
      'From: a@example.com',
      'To: b@example.com',
      'Subject: Parts',
      'Message-ID: <parts@example.com>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Body</p><img src="cid:shown@x">',
      parts,
      '--b--',
      '',
    ].join('\r\n'),
  );
}

function imagePart(name: string, bytes: number, headers: string[]): string {
  return [
    '--b',
    `Content-Type: image/png; name="${name}"`,
    ...headers,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.alloc(bytes, 7).toString('base64'),
  ].join('\r\n');
}

describe('parseMessage', () => {
  it('reads encoded headers, addresses, the text and the real attachments', async () => {
    const parsed = await parseMessage(fixture('attachments.eml'));
    expect(parsed.messageId).toBe('<invoice-1@example.com>');
    expect(parsed.subject).toBe('Rechnung für März');
    expect(parsed.from).toEqual({ name: 'Jürgen Müller', address: 'juergen@example.com' });
    expect(parsed.to).toEqual([{ name: 'Patrick', address: 'patrick@example.org' }]);
    expect(parsed.cc).toEqual([{ name: 'Office', address: 'office@example.org' }]);
    expect(parsed.date.toISOString()).toBe('2026-03-10T11:00:00.000Z');
    expect(parsed.text).toContain('anbei die Rechnung');
    expect(parsed.snippet).toBe('Hallo Patrick, anbei die Rechnung.');
    expect(parsed.html).toContain('src="cid:logo@example.com"');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      filename: 'Rechnung März.pdf',
      contentType: 'application/pdf',
      contentId: null,
    });
    expect(parsed.attachments[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('decodes ISO-8859-1 quoted-printable text and headers', async () => {
    const parsed = await parseMessage(fixture('latin1-qp.eml'));
    expect(parsed.subject).toBe('Grüße aus Köln');
    expect(parsed.from?.name).toBe('Bärbel Grün');
    expect(parsed.text).toContain('Liebe Grüße aus Köln');
    expect(parsed.text).toContain('die Straße ist schön.');
    expect(parsed.html).toBeNull();
  });

  it('sanitizes HTML and blocks remote images', async () => {
    const parsed = await parseMessage(fixture('html-remote.eml'));
    expect(parsed.hasRemoteImages).toBe(true);
    expect(parsed.html).not.toContain('<script');
    expect(parsed.html).not.toContain('Hidden title');
    expect(parsed.html).not.toContain('onclick');
    expect(parsed.html).not.toContain('onload');
    expect(parsed.html).not.toContain('javascript:');
    expect(parsed.html).not.toContain('<form');
    expect(parsed.html).not.toContain('<iframe');
    expect(parsed.html).not.toContain('url(');
    expect(parsed.html).not.toContain(' src="https://');
    expect(parsed.html).toContain('data-remote-src="https://cdn.shop.example/banner.jpg"');
    expect(parsed.html).toContain('data-remote-src="https://tracker.example/pixel.gif"');
    expect(parsed.html).toContain('style="color:red"');
    expect(parsed.html).toContain('target="_blank"');
    expect(parsed.text).toContain('Angebote');
  });

  it('reads the thread headers of a reply', async () => {
    const parsed = await parseMessage(fixture('reply.eml'));
    expect(parsed.inReplyTo).toBe('<start-1@example.org>');
    expect(parsed.references).toEqual(['<start-1@example.org>', '<reply-1@example.com>']);
    expect(threadKeyOf(parsed)).toBe('<start-1@example.org>');
    expect(parsed.snippet).toBe('Passt, danke!');
  });

  it('gives a message without Message-ID a stable id from its content', async () => {
    const fallback = new Date('2026-01-02T03:04:05Z');
    const first = await parseMessage(fixture('no-message-id.eml'), fallback);
    const second = await parseMessage(fixture('no-message-id.eml'), fallback);
    expect(first.messageId).toMatch(/^<[0-9a-f]{64}@plan\.local>$/);
    expect(second.messageId).toBe(first.messageId);
    expect(first.date).toEqual(fallback);
    expect(threadKeyOf(first)).toBe(first.messageId);
  });

  it('leaves out inline images referenced by cid and small inline logos', async () => {
    const raw = mime(
      [
        imagePart('shown.png', 40_000, ['Content-ID: <shown@x>', 'Content-Disposition: inline']),
        imagePart('logo.png', 3_000, ['Content-ID: <logo@x>', 'Content-Disposition: inline']),
        imagePart('photo.png', 40_000, ['Content-Disposition: inline; filename="photo.png"']),
        imagePart('tiny.png', 2_000, ['Content-Disposition: attachment; filename="tiny.png"']),
      ].join('\r\n'),
    );
    const parsed = await parseMessage(raw);
    expect(parsed.attachments.map((item) => item.filename)).toEqual(['photo.png', 'tiny.png']);
  });

  it('finds an inline part by its Content-ID', async () => {
    const part = await findInlinePart(fixture('attachments.eml'), 'logo@example.com');
    expect(part?.contentType).toBe('image/png');
    expect(part?.content.subarray(1, 4).toString()).toBe('PNG');
    expect(await findInlinePart(fixture('attachments.eml'), 'missing@x')).toBeNull();
  });
});

describe('snippetOf', () => {
  it('drops quoted lines and collapses whitespace', () => {
    expect(snippetOf('Hi\n\n> quoted\n  there ')).toBe('Hi there');
    expect(snippetOf('x'.repeat(300))).toHaveLength(200);
  });
});

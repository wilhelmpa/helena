import { describe, expect, it } from 'bun:test';
import { redactUrl, safeDownloadName } from './session';

describe('safeDownloadName', () => {
  it('keeps the name, never a directory, a control character or a leading dot', () => {
    expect(safeDownloadName('bericht 2026.txt')).toBe('bericht 2026.txt');
    expect(safeDownloadName('../../etc/passwd')).toBe('passwd');
    expect(safeDownloadName('C:\\temp\\rechnung.pdf')).toBe('rechnung.pdf');
    expect(safeDownloadName('.bashrc')).toBe('bashrc');
    expect(safeDownloadName('a\u0000b\u001fc\u007f.txt')).toBe('abc.txt');
    expect(safeDownloadName('')).toBe('download');
    expect(safeDownloadName('x'.repeat(300)).length).toBe(180);
  });
});

describe('redactUrl', () => {
  it('hides authenticating query values and user info, keeps the rest', () => {
    expect(redactUrl('https://a.example/cb?code=abc123&state=xyz&page=2')).toBe(
      'https://a.example/cb?code=%E2%80%A6&state=xyz&page=2',
    );
    expect(redactUrl('https://user:pw@a.example/x?access_token=t')).toBe(
      'https://a.example/x?access_token=%E2%80%A6',
    );
    expect(redactUrl('https://a.example/#id_token=secret')).toBe('https://a.example/#%E2%80%A6');
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

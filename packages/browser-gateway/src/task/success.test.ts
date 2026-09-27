import { describe, expect, it } from 'bun:test';
import { contactSite } from './fake-site';
import { matchesSuccess, taskSuccess } from './success';

describe('independent success criteria', () => {
  it('validates the bounded, selector-free caller contract', () => {
    expect(taskSuccess(undefined)).toBeUndefined();
    expect(
      taskSuccess({ url: 'https://site.test', fields: [{ label: 'Name', value: '' }] }),
    ).toEqual({ url: 'https://site.test/', fields: [{ label: 'Name', value: '' }] });
    for (const value of [
      null,
      {},
      [],
      { script: 'return true' },
      { url: 'javascript:alert(1)' },
      { url: 'https://user:secret@site.test' },
      { textIncludes: [] },
      { textIncludes: [''] },
      { textIncludes: Array(11).fill('x') },
      { fields: [{ label: 'Name' }] },
      { fields: [{ label: 'Name', checked: 'true' }] },
      { fields: [{ label: 'Name', value: '', selector: '#x' }] },
    ]) {
      expect(() => taskSuccess(value)).toThrow();
    }
  });

  it('requires every criterion and rejects ambiguous or credential fields', async () => {
    const site = contactSite();
    site.url = '/kontakt';
    const page = await site.observe();
    page.text = 'Contact ready';
    page.elements[0]!.label = 'Name';
    page.elements[0]!.value = 'Ada';
    page.elements[0]!.valueExact = true;
    const criteria = {
      url: page.url,
      textIncludes: ['Contact ready'],
      fields: [{ label: 'Name', value: 'Ada' }],
    };
    expect(matchesSuccess(page, criteria)).toBe(true);
    page.elements[0]!.valueExact = false;
    expect(matchesSuccess(page, criteria)).toBe(false);
    page.elements[0]!.valueExact = true;
    expect(matchesSuccess(page, { fields: [] })).toBe(false);
    expect(matchesSuccess(page, { textIncludes: [''] })).toBe(false);
    expect(matchesSuccess(page, { ...criteria, url: 'https://site.test/danke' })).toBe(false);
    expect(matchesSuccess(page, { ...criteria, textIncludes: ['Sent'] })).toBe(false);
    expect(matchesSuccess({ ...page, jsDialog: 'confirm?' }, criteria)).toBe(false);
    expect(
      matchesSuccess(
        { ...page, elements: [...page.elements, { ...page.elements[0]!, i: 9 }] },
        criteria,
      ),
    ).toBe(false);
    page.elements[0]!.credential = true;
    expect(matchesSuccess(page, criteria)).toBe(false);
  });
});

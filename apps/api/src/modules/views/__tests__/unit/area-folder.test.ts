import { describe, it, expect } from 'bun:test';
import { HttpError } from '#shared/lib';
import { areaFolderSlug, assertAreaFolder, uniqueAreaFolder } from '../../area-folder';

describe('areaFolderSlug', () => {
  it('keeps lowercase letters and digits and joins the rest with hyphens', () => {
    expect(areaFolderSlug('Backend')).toBe('backend');
    expect(areaFolderSlug('  Design & UX / Q4  ')).toBe('design-ux-q4');
  });

  it('transliterates German umlauts and drops other accents', () => {
    expect(areaFolderSlug('Größe & Übergänge')).toBe('groesse-uebergaenge');
    expect(areaFolderSlug('Café Crème')).toBe('cafe-creme');
  });

  it('cuts a long name to 48 characters without a trailing hyphen', () => {
    const slug = areaFolderSlug(`${'a'.repeat(47)} b`);
    expect(slug).toBe('a'.repeat(47));
  });

  it("falls back to 'area' when nothing is left", () => {
    expect(areaFolderSlug('日本語')).toBe('area');
    expect(areaFolderSlug('!!!')).toBe('area');
  });
});

describe('uniqueAreaFolder', () => {
  it('numbers a folder the project already uses or a reserved one', () => {
    expect(uniqueAreaFolder('design', new Set())).toBe('design');
    expect(uniqueAreaFolder('design', new Set(['design', 'design-2']))).toBe('design-3');
    expect(uniqueAreaFolder('docs', new Set())).toBe('docs-2');
  });
});

describe('assertAreaFolder', () => {
  it('refuses a reserved folder with 400 and a taken one with 409', () => {
    const status = (folder: string, taken: string[]) => {
      try {
        assertAreaFolder(folder, new Set(taken));
        return 200;
      } catch (error) {
        return (error as HttpError).status;
      }
    };
    expect(status('boards', [])).toBe(400);
    expect(status('backend', ['backend'])).toBe(409);
    expect(status('backend', ['design'])).toBe(200);
  });
});

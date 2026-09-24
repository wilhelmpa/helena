import { describe, expect, it } from 'bun:test';
import { localeFromAcceptLanguage } from './accept-language';

describe('localeFromAcceptLanguage', () => {
  it('uses the preferred supported language', () => {
    expect(localeFromAcceptLanguage('ru;q=0.4,zh-CN;q=0.9,en;q=0.8')).toBe('zh-CN');
  });

  it('matches regional browser locales to the shipped language', () => {
    expect(localeFromAcceptLanguage('uk-UA,uk;q=0.9,en;q=0.8')).toBe('uk');
    expect(localeFromAcceptLanguage('ar-SA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(localeFromAcceptLanguage('id-ID,id;q=0.9,en;q=0.8')).toBe('id');
    expect(localeFromAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('es-ES');
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(localeFromAcceptLanguage('de-AT')).toBe('de');
    expect(localeFromAcceptLanguage('es-MX')).toBe('es-ES');
    expect(localeFromAcceptLanguage('pt')).toBe('pt-BR');
    expect(localeFromAcceptLanguage('fr-CH, fr;q=0.9')).toBe('fr');
  });

  it('uses the fallback for a preferred wildcard', () => {
    expect(localeFromAcceptLanguage('ja-JP,*;q=0.9,zh;q=0.8')).toBe('en');
  });

  it('falls back to English when no requested language is supported', () => {
    expect(localeFromAcceptLanguage('ja-JP,ko;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage(null)).toBe('en');
    expect(localeFromAcceptLanguage('')).toBe('en');
  });

  it('skips a malformed tag instead of failing', () => {
    expect(localeFromAcceptLanguage('not a tag!,de;q=0.5')).toBe('de');
  });

  it('honours quality values over order', () => {
    expect(localeFromAcceptLanguage('en;q=0.1, fr;q=0.8, de;q=0.9')).toBe('de');
  });
});

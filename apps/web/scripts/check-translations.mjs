import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../messages/', import.meta.url);
const locales = ['en', 'de', 'uk', 'ru', 'zh-CN', 'ar', 'fr', 'pt-BR', 'id', 'es-ES'];
const actions = [
  'apply',
  'create',
  'update',
  'update-role',
  'delete-role',
  'delete',
  'undo',
  'profile-follow',
];
const read = (locale, file) => JSON.parse(readFileSync(new URL(`${locale}/${file}`, root), 'utf8'));
const flatten = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' ? flatten(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );

export function translationErrors() {
  const errors = [];
  for (const file of readdirSync(new URL('en/', root))) {
    if (!file.endsWith('.json')) continue;
    const reference = flatten(read('en', file));
    for (const locale of locales) {
      const keys = flatten(read(locale, file));
      for (const key of reference)
        if (!keys.includes(key)) errors.push(`${locale}/${file}: missing ${key}`);
      for (const key of keys)
        if (!reference.includes(key)) errors.push(`${locale}/${file}: extra ${key}`);
    }
  }
  const englishWake = read('en', 'localAi.json').voice.wake;
  for (const locale of locales) {
    const messages = read(locale, 'localAi.json');
    for (const action of actions) {
      if (!messages.modelMatrix.schemaEditor.audit.actions[action])
        errors.push(`${locale}: missing audit action ${action}`);
    }
    if (locale !== 'en')
      for (const [key, value] of Object.entries(englishWake)) {
        if (!messages.voice.wake[key] || messages.voice.wake[key] === value)
          errors.push(`${locale}: untranslated voice.wake.${key}`);
      }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = translationErrors();
  for (const error of errors) console.error(error);
  console.log(`Translations: ${locales.length} languages, ${errors.length} errors`);
  process.exitCode = errors.length ? 1 : 0;
}

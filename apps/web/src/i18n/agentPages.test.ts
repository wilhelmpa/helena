import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

// The texts of the agent pages (skills, memory, instructions, learning) are for people, not for
// people who know what runs underneath (owner 30.09.): no "Hermes", "Runner" or "Kurator" on
// screen, and every language has every key.

const root = new URL('../../messages/', import.meta.url);
const locales = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

type Tree = { [key: string]: string | Tree };

function messages(locale: string): Tree {
  return JSON.parse(readFileSync(new URL(`${locale}/agentPages.json`, root), 'utf8'));
}

function strings(value: string | Tree, path = ''): [string, string][] {
  return typeof value === 'string'
    ? [[path, value]]
    : Object.entries(value).flatMap(([key, child]) =>
        strings(child, path ? `${path}.${key}` : key),
      );
}

describe('agentPages messages', () => {
  const english = strings(messages('en'));

  for (const locale of locales) {
    it(`${locale} has every key of English and keeps its placeholders`, () => {
      const own = new Map(strings(messages(locale)));
      for (const [key, text] of english) {
        assert.ok(own.has(key), `${locale} misses ${key}`);
        const placeholders = (value: string) =>
          [...value.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]).sort();
        assert.deepEqual(placeholders(own.get(key)!), placeholders(text), `${locale} ${key}`);
      }
      assert.equal(own.size, english.length, `${locale} has keys English does not`);
    });
  }

  for (const locale of ['de', 'en']) {
    it(`${locale} says nothing about the runtime underneath`, () => {
      for (const [key, text] of strings(messages(locale))) {
        assert.doesNotMatch(text, /hermes|runner|kurator|curator/i, `${locale} ${key}: ${text}`);
      }
    });
  }
});

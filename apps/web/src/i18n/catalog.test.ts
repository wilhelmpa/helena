import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

// The texts of the skill and MCP catalog are read by the owner deciding what agents may
// load, so every language must have every key, keep every placeholder and balance its
// plural braces; and no language names the machinery underneath (owner 30.09.).

const root = new URL('../../messages/', import.meta.url);
const locales = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

type Tree = { [key: string]: string | Tree };

function messages(locale: string): Tree {
  return JSON.parse(readFileSync(new URL(`${locale}/catalog.json`, root), 'utf8'));
}

function strings(value: string | Tree, path = ''): [string, string][] {
  return typeof value === 'string'
    ? [[path, value]]
    : Object.entries(value).flatMap(([key, child]) =>
        strings(child, path ? `${path}.${key}` : key),
      );
}

// The variables of a message: the name after each "{" that opens an argument, not the
// words of the plural branches ("one {is} other {are}").
function placeholders(value: string): string[] {
  const names: string[] = [];
  const stack: ('arg' | 'branch')[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '{') {
      if (stack.at(-1) === 'arg') {
        stack.push('branch');
      } else {
        const name = /^\w+/.exec(value.slice(index + 1))?.[0];
        if (name) names.push(name);
        stack.push('arg');
      }
    } else if (char === '}') {
      stack.pop();
    }
  }
  return [...new Set(names)].sort();
}

describe('catalog messages', () => {
  const english = strings(messages('en'));

  for (const locale of locales) {
    it(`${locale} has every key of English, keeps its placeholders and balances its braces`, () => {
      const own = new Map(strings(messages(locale)));
      for (const [key, text] of english) {
        assert.ok(own.has(key), `${locale} misses ${key}`);
        const translated = own.get(key)!;
        assert.deepEqual(placeholders(translated), placeholders(text), `${locale} ${key}`);
        const open = (translated.match(/\{/g) ?? []).length;
        const close = (translated.match(/\}/g) ?? []).length;
        assert.equal(open, close, `${locale} ${key} has unbalanced braces`);
        assert.notEqual(translated.trim(), '', `${locale} ${key} is empty`);
      }
      assert.equal(own.size, english.length, `${locale} has keys English does not`);
    });
  }

  for (const locale of ['de', 'en']) {
    it(`${locale} says nothing about the runtime underneath`, () => {
      for (const [key, text] of strings(messages(locale))) {
        assert.doesNotMatch(
          text,
          /hermes|runner|kurator|curator|helena/i,
          `${locale} ${key}: ${text}`,
        );
      }
    });
  }
});

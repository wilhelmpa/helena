import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectDelimiter, parseDelimited } from './delimited';

describe('delimited text', () => {
  it('reads quoted cells with separators, quotes and line breaks', () => {
    assert.deepEqual(parseDelimited('a,"b,1","say ""hi""","x\ny"\r\n1,2,3,4\n'), [
      ['a', 'b,1', 'say "hi"', 'x\ny'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('keeps empty cells and the last row without a line break', () => {
    assert.deepEqual(parseDelimited('a,,c\n,,'), [
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('drops a byte order mark', () => {
    assert.deepEqual(parseDelimited('﻿name,count\nA,1'), [
      ['name', 'count'],
      ['A', '1'],
    ]);
  });

  it('finds the separator from the first lines or the extension', () => {
    assert.equal(detectDelimiter('name;anzahl;preis\nA;1;2,5\n'), ';');
    assert.equal(detectDelimiter('a\tb\tc\n'), '\t');
    assert.equal(detectDelimiter('a,b,c\n'), ',');
    assert.equal(detectDelimiter('einfach text', 'x.tsv'), '\t');
    assert.equal(detectDelimiter('nothing here'), ',');
  });
});

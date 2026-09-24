import { describe, expect, test } from 'bun:test';

import { evaluate, render } from './helena-licenses';

describe('license policy', () => {
  test('permissive licenses are allowed', () => {
    for (const id of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'MPL-2.0', '0BSD', 'MIT/X11']) {
      expect(evaluate(id).policy).toBe('allowed');
    }
  });

  test('source-available and non-commercial licenses are forbidden', () => {
    for (const id of ['Elastic-2.0', 'SSPL-1.0', 'BUSL-1.1', 'CC-BY-NC-4.0', 'MIT AND Commons-Clause']) {
      expect(evaluate(id).policy).toBe('forbidden');
    }
  });

  test('OR takes the best alternative, AND the worst part', () => {
    expect(evaluate('(MIT OR GPL-3.0-or-later)').policy).toBe('allowed');
    expect(evaluate('(MPL-2.0 OR Apache-2.0)').policy).toBe('allowed');
    expect(evaluate('Apache-2.0 AND MIT').policy).toBe('allowed');
    expect(evaluate('(MIT AND CC-BY-4.0)').policy).toBe('notice');
    expect(evaluate('(Elastic-2.0 OR SSPL-1.0)').policy).toBe('forbidden');
  });

  test('copyleft compatible with AGPL is a notice, unknown needs review', () => {
    expect(evaluate('LGPL-3.0-or-later').policy).toBe('notice');
    expect(evaluate('GPL-3.0-only').policy).toBe('notice');
    expect(evaluate('Unknown').policy).toBe('review');
    expect(evaluate('SomethingNew-1.0').policy).toBe('review');
  });

  test('the report lists what needs attention', () => {
    const text = render(
      [
        { name: 'a', version: '1.0.0', license: 'MIT', source: 'bun.lock', scope: 'runtime' },
        { name: 'b', version: '2.0.0', license: 'Unknown', source: 'bun.lock', scope: 'runtime' },
      ],
      ['bun.lock'],
    );
    expect(text).toContain('| MIT | allowed | 1 | 0 |');
    expect(text).toContain('| b@2.0.0 | Unknown | review | runtime | no license declared |');
  });
});

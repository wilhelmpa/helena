import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// Request schemas take choices through oneOf (#shared/schemas), never t.UnionEnum inside
// t.Optional: Elysia gives a UnionEnum its first value as the default, which fills in a field
// an update leaves out.
describe('request schemas', () => {
  it('never wrap t.UnionEnum in t.Optional', async () => {
    const offenders: string[] = [];
    for await (const file of new Glob('modules/**/*.ts').scan({
      cwd: `${import.meta.dir}/../../..`,
    })) {
      if (file.includes('__tests__')) continue;
      const text = await Bun.file(`${import.meta.dir}/../../../${file}`).text();
      if (/t\.Optional\(\s*t\.UnionEnum\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

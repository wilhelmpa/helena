import { describe, expect, test } from 'bun:test';
import { isSystemVaultPath, vaultOrigin } from '../origin';

describe('vaultOrigin', () => {
  test('front matter names the origin', () => {
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/A.md', frontmatter: { origin: 'agent' } })).toBe(
      'agent',
    );
    expect(
      vaultOrigin({
        path: 'Projects/VOL/Files/Belege/2026-09/x.pdf',
        frontmatter: { origin: 'manual' },
      }),
    ).toBe('manual');
  });

  test('an unknown origin value is ignored', () => {
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/A.md', frontmatter: { origin: 'robot' } })).toBe(
      'manual',
    );
  });

  test('generated projections and system folders are the system', () => {
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/B.md', frontmatter: { generated: true } })).toBe(
      'system',
    );
    expect(vaultOrigin({ path: 'Projects/VOL/Files/Belege/2026-09/r.pdf' })).toBe('system');
    expect(vaultOrigin({ path: 'Projects/VOL/Files/Mail/a.pdf' })).toBe('system');
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/Agenten/Coder.md' })).toBe('system');
  });

  test('an agent write is the agent, anything else manual', () => {
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/C.md', lastAuthor: 'agent:12' })).toBe('agent');
    expect(vaultOrigin({ path: 'Projects/VOL/Files/Browser/run-4.png' })).toBe('agent');
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/C.md', lastAuthor: 'user:abc' })).toBe('manual');
    expect(vaultOrigin({ path: 'Projects/VOL/Docs/C.md', lastAuthor: 'extern' })).toBe('manual');
    expect(vaultOrigin({ path: 'Home/Docs/D.md' })).toBe('manual');
  });

  test('system folders need the project prefix', () => {
    expect(isSystemVaultPath('Projects/VOL/Files/Belege')).toBe(true);
    expect(isSystemVaultPath('Projects/VOL/Files/Belegexyz/a.pdf')).toBe(false);
    expect(isSystemVaultPath('Home/Files/Mail/2026/a.pdf')).toBe(true);
    expect(isSystemVaultPath('Private/Files/Mail/a.pdf')).toBe(false);
  });
});

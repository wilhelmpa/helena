import { describe, expect, it } from 'bun:test';
import { isAllowedResultKind, sanitizeResourceUrl } from '../../provisioning-resource-url';

describe('board provisioning result links', () => {
  it('keeps only the requested board and its validated workspace deep link', () => {
    const requested = new Set(['board:12']);
    expect(isAllowedResultKind('board:12', requested)).toBe(true);
    expect(
      sanitizeResourceUrl(
        'board:12',
        'https://code.example/?folder=/projects/demo/boards/board-12&token=secret',
      ),
    ).toBe('https://code.example/?folder=%2Fprojects%2Fdemo%2Fboards%2Fboard-12');
    expect(
      sanitizeResourceUrl(
        'board:12',
        'https://code.example/?folder=/projects/demo/boards/board-13&token=secret',
      ),
    ).toBe('https://code.example/');
  });

  it('rejects board file results even when a caller requested that legacy kind', () => {
    const requested = new Set(['board:12', 'board:12:files']);
    expect(isAllowedResultKind('board:12:files', requested)).toBe(false);
    expect(
      sanitizeResourceUrl(
        'board:12:files',
        'https://cloud.example/?dir=/Projects/DEMO/Files/Boards/board-12',
      ),
    ).toBe('https://cloud.example/');
  });
});

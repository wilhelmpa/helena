import { describe, expect, it } from 'bun:test';
import { agentFileName } from '../export';

describe('agentFileName', () => {
  it('names the note after the handle and keeps it unique with the id', () => {
    expect(agentFileName({ id: 12, username: 'scout' })).toBe('scout (12).md');
  });

  it('drops path separators and control characters', () => {
    expect(agentFileName({ id: 3, username: '../x/y\u0000z' })).toBe('x-y-z (3).md');
    expect(agentFileName({ id: 4, username: '...' })).toBe('agent (4).md');
  });
});

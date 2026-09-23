import { describe, it, expect } from 'bun:test';
import { projectAreasSection } from '../../areas';

describe('projectAreasSection', () => {
  it('lists the areas of each project with their folders', () => {
    const text = projectAreasSection([
      {
        key: 'MKT',
        areas: [
          { name: 'Backend', folder: 'backend' },
          { name: 'Design & UX', folder: 'design-ux' },
        ],
      },
      { key: 'OPS', areas: [] },
    ]);
    expect(text).toStartWith('## Areas');
    expect(text).toContain('- MKT: Backend (folder backend), Design & UX (folder design-ux)');
    expect(text).not.toContain('OPS');
  });

  it('is empty when no project has an area', () => {
    expect(projectAreasSection([{ key: 'MKT', areas: [] }])).toBe('');
  });
});

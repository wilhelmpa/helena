import { describe, expect, test } from 'bun:test';
import { acceptanceCriteria } from '../../agent-team';

describe('agent-team acceptance criteria', () => {
  test('takes the Markdown checklist items of the description', () => {
    expect(
      acceptanceCriteria(
        [
          'Intro text',
          '- [ ] Open item',
          '- [x] Done item  ',
          '  - [X] Nested item',
          '* [ ] Star item',
          '- plain bullet',
          '- [ ]',
          '1. [ ] numbered',
        ].join('\n'),
      ),
    ).toEqual(['Open item', 'Done item', 'Nested item', 'Star item']);
  });

  test('falls back to one criterion and keeps the bounds of the stage contract', () => {
    expect(acceptanceCriteria('No checklist here')).toEqual([
      'The work item is done as its description asks.',
    ]);
    const many = Array.from({ length: 31 }, (_, index) => `- [ ] ${index} ${'x'.repeat(1_100)}`);
    const criteria = acceptanceCriteria(many.join('\n'));
    expect(criteria).toHaveLength(30);
    expect(criteria[0]).toHaveLength(1_000);
  });
});

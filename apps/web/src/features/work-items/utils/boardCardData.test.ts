import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardIssue } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Maps } from '@/utils/project';
import { setDisplayLocale } from '@/utils/dates';
import { boardCardData, cardProperties } from './boardCardData';

const project = {
  customFields: [
    { id: 1, name: 'Preis', fieldType: 'number' },
    { id: 2, name: 'RSI', fieldType: 'number' },
    { id: 3, name: 'MACD', fieldType: 'text' },
  ],
} as ProjectDetail;
const maps = { columnById: new Map(), typeById: new Map(), labelById: new Map() } as Maps;
const priorityLabel = (priority: string | null) => priority ?? '';
const words = (key: string, value: string) =>
  key === 'statusAge' ? `seit ${value}` : key === 'status' ? value : `${key} ${value}`;

function issue(fieldValues: BoardIssue['fieldValues'], dueDate: string | null = null) {
  return {
    fieldValues,
    dueDate,
    labelIds: [],
    columnId: 1,
    statusSince: '2026-09-28T00:00:00Z',
  } as unknown as BoardIssue;
}

describe('board card data', () => {
  it('puts Preis above the selected indicators even when RSI comes first', () => {
    const data = boardCardData(
      issue([
        { fieldId: 1, value: 771.35, valueEnd: null, optionIds: [] },
        { fieldId: 2, value: 57, valueEnd: null, optionIds: [] },
        { fieldId: 3, value: '2,12 / 1,31', valueEnd: null, optionIds: [] },
      ]),
      project,
      maps,
      ['cf:2', 'cf:1', 'cf:3'],
      priorityLabel,
      words,
    );
    assert.equal(data.importantValue, '771,35');
    assert.deepEqual(data.meta, ['RSI 57', 'MACD 2,12 / 1,31']);
  });

  it('uses the due date when the view has no populated number field', () => {
    setDisplayLocale('de');
    const data = boardCardData(
      issue([], '2026-10-03'),
      project,
      maps,
      ['cf:1'],
      priorityLabel,
      words,
    );
    assert.equal(data.importantValue, '3. Okt.');
    assert.deepEqual(data.meta, []);
  });

  it('renders a selected option field in the mono line', () => {
    const withOption = {
      customFields: [
        { id: 4, name: 'Bewertung', fieldType: 'select', options: [{ id: 6, value: 'positiv' }] },
      ],
    } as ProjectDetail;
    const data = boardCardData(
      issue([{ fieldId: 4, value: null, valueEnd: null, optionIds: [6] }]),
      withOption,
      maps,
      ['cf:4'],
      priorityLabel,
      words,
    );
    assert.deepEqual(data.meta, ['Bewertung positiv']);
  });

  it("says how long the task has been in its status, in the reader's words", () => {
    const data = boardCardData(issue([]), project, maps, ['statusAge'], priorityLabel, words);
    assert.match(data.meta[0]!, /^seit /);
  });

  it('leaves the status out where the column already names it', () => {
    const withColumn = {
      ...maps,
      columnById: new Map([[1, { id: 1, name: 'Neu' }]]),
    } as unknown as Maps;
    const shown = boardCardData(issue([]), project, withColumn, ['status'], priorityLabel, words);
    assert.deepEqual(shown.meta, ['Neu']);
    assert.deepEqual(cardProperties({ properties: ['status', 'priority'], group: 'status' }), [
      'priority',
    ]);
    assert.deepEqual(cardProperties({ properties: ['status'], group: 'priority' }), ['status']);
  });
});

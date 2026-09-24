import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeViewSettings, type ViewSettings } from './viewSettings';

describe('the first day of a calendar week', () => {
  it('follows the language unless a view chose one', () => {
    assert.equal(normalizeViewSettings(null, 'calendar').firstDayOfWeek, 'locale');
    assert.equal(
      normalizeViewSettings({ firstDayOfWeek: 1 } as Partial<ViewSettings>, 'calendar')
        .firstDayOfWeek,
      1,
    );
  });

  it('does not read the old key, which every view stored as Sunday', () => {
    const legacy = { weekStart: 0 } as unknown as Partial<ViewSettings>;
    assert.equal(normalizeViewSettings(legacy, 'calendar').firstDayOfWeek, 'locale');
  });
});

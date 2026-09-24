import { describe, expect, it } from 'bun:test';
import type { HistoryEntry, RoundInput } from './policy';
import {
  clickIntoField,
  confirmsEntry,
  evidenceComplete,
  fillBeforeSubmit,
  hardToUndo,
  layaRound,
  missingEvidence,
  quotedTexts,
  repeatsSubmit,
  showsLogin,
  tickBeforeSubmit,
  unsubmitted,
  valueForField,
} from './policy-laya';
import type { PageElement, PageObservation } from './types';

let next = 1;
function el(fields: Partial<PageElement> & { role: string }): PageElement {
  const i = next++;
  return { id: i, i, frame: 0, tag: 'input', ...fields };
}

function input(
  elements: PageElement[],
  over: Partial<RoundInput> & { text?: string; title?: string } = {},
): RoundInput {
  const observation: PageObservation = {
    url: 'http://shop.test/',
    title: over.title ?? 'Shop',
    text: over.text ?? '',
    dialogs: [],
    metrics: { scrollY: 0, pageHeight: 800, viewportHeight: 800, textLength: 0, elements: 0 },
    elements,
    omitted: 0,
    keys: ['k'],
    jsDialog: null,
  };
  return {
    observation,
    goal: over.goal ?? 'Suche nach „Rucksack“',
    values: over.values ?? {},
    mode: over.mode ?? 'act',
    round: over.round ?? 1,
    history: over.history ?? [],
    excluded: over.excluded ?? new Set(),
  };
}

const typed = (element: string, key: string): HistoryEntry => ({
  action: 'type_text',
  element,
  value: key,
  page_changed: false,
});

describe('Laya policy rules', () => {
  it('matches a value by the field itself before the text near it', () => {
    // "Name" is the previous field's label, next to the e-mail field.
    const email = el({
      role: 'textbox',
      label: 'E-Mail',
      name: 'email',
      near: 'Name',
      editable: true,
    });
    expect(valueForField(email, { name: 'Ada', email: 'ada@example.com' })).toBe('email');
    const unnamed = el({ role: 'textbox', near: 'Postleitzahl', editable: true });
    expect(valueForField(unnamed, { postleitzahl: '10115', city: 'Berlin' })).toBe('postleitzahl');
  });

  it('fills an empty field before submitting, once per value', () => {
    const field = el({ role: 'searchbox', label: 'Suchbegriff', editable: true, value: '' });
    const submit = el({ role: 'button', label: 'Suchen', submits: true });
    const round = input([field, submit], { values: { query: 'Rucksack' } });
    expect(fillBeforeSubmit(round, submit, [field])).toEqual({ element: field, valueKey: 'query' });
    // Typed already (the results page shows the field empty again): no second fill.
    const later = input([field, submit], {
      values: { query: 'Rucksack' },
      history: [typed('searchbox "Suchbegriff"', 'query')],
    });
    expect(fillBeforeSubmit(later, submit, [field])).toBeNull();
  });

  it('types instead of clicking into a field a value names', () => {
    const field = el({ role: 'textbox', label: 'E-Mail', editable: true, value: '' });
    const round = input([field], { values: { email: 'ada@example.com', name: 'Ada' } });
    expect(clickIntoField(round, field)?.valueKey).toBe('email');
    const filled = { ...field, value: 'ada@example.com' };
    expect(clickIntoField(round, filled)).toBeNull();
  });

  it('does not submit the same empty form twice', () => {
    const field = el({ role: 'searchbox', label: 'Suchbegriff', editable: true, value: '' });
    const submit = el({ role: 'button', label: 'Suchen', submits: true });
    const round = input([field, submit], {
      history: [
        typed('searchbox "Suchbegriff"', 'query'),
        { action: 'click', element: 'button "Suchen"', page_changed: true },
      ],
    });
    expect(repeatsSubmit(round, submit, [field])).toBe(true);
    expect(repeatsSubmit({ ...round, history: round.history.slice(0, 1) }, submit, [field])).toBe(
      false,
    );
  });

  it('ticks a checkbox the goal names before submitting, never one to leave alone', () => {
    const agb = el({ role: 'checkbox', label: 'Ich akzeptiere die AGB', checked: false });
    const news = el({ role: 'checkbox', label: 'Newsletter abonnieren', checked: true });
    const submit = el({ role: 'button', label: 'Weiter zur Kasse', submits: true });
    const goal = 'Akzeptiere die AGB und gehe weiter zur Kasse. Den Newsletter so lassen.';
    expect(tickBeforeSubmit(input([agb, news, submit], { goal }), submit, [agb, news])).toBe(agb);
    expect(
      tickBeforeSubmit(input([agb, submit], { goal: 'Deaktiviere die AGB' }), submit, [agb]),
    ).toBeNull();
  });

  it('presses Enter when the field just typed into is clicked again', () => {
    const field = el({ role: 'textbox', label: 'What needs to be done?', editable: true });
    const round = input([{ ...field, value: 'Milch kaufen' }], {
      values: { todo: 'Milch kaufen' },
      history: [typed('textbox "What needs to be done?"', 'todo')],
    });
    expect(confirmsEntry(round, { ...field, value: 'Milch kaufen' })).toBe(true);
    expect(confirmsEntry(round, { ...field, value: '' })).toBe(false);
  });

  it('wants the quoted texts on the page before DONE', () => {
    expect(quotedTexts('Lade alles, bis „Alle geladen“ und "Fertig" erscheint')).toEqual([
      'Alle geladen',
      'Fertig',
    ]);
    expect(quotedTexts("Don't stop, it's fine")).toEqual([]);
    const goal = 'Lade alle Neuigkeiten, bis „Alle Neuigkeiten geladen“ angezeigt wird';
    expect(missingEvidence(input([], { goal, text: 'Neuigkeiten 1–5 Mehr laden' }))).toBe(true);
    expect(missingEvidence(input([], { goal, text: 'Alle Neuigkeiten geladen' }))).toBe(false);
  });

  it('calls a task done when its evidence shows after a page change', () => {
    const goal = 'Add the todo "Milch kaufen"';
    const history: HistoryEntry[] = [
      typed('textbox "What needs to be done?"', 'todo'),
      { action: 'press_enter', element: 'textbox "What needs to be done?"', page_changed: true },
    ];
    const done = input([], {
      goal,
      values: { todo: 'Milch kaufen' },
      history,
      text: 'Milch kaufen 1 item left',
    });
    expect(evidenceComplete(done)).toBe(true);
    // A result still to open is not the evidence.
    const link = el({ role: 'link', label: 'Milch kaufen (Rezept)' });
    expect(
      evidenceComplete({ ...done, observation: { ...done.observation, elements: [link] } }),
    ).toBe(false);
    // Right after typing, nothing was sent yet.
    expect(evidenceComplete({ ...done, history: history.slice(0, 1) })).toBe(false);
  });

  it('does not accept DONE right after typing when the goal asks to submit', () => {
    const submit = el({ role: 'button', label: 'Submit', submits: true });
    const round = input([submit], {
      goal: 'Type the text and submit the form',
      history: [typed('textbox "Text input"', 'text')],
    });
    expect(unsubmitted(round, [submit])).toBe(true);
    expect(unsubmitted({ ...round, goal: 'Type the text into the field' }, [submit])).toBe(false);
  });

  it('pauses before what is hard to undo unless the goal asks for it', () => {
    const buy = el({ role: 'button', label: 'Jetzt kaufen' });
    const send = el({ role: 'button', label: 'Senden', submits: true });
    expect(hardToUndo('Gehe weiter zur Kasse', buy)).toBe(true);
    expect(hardToUndo('Kaufe den Rucksack', buy)).toBe(false);
    expect(hardToUndo('Fülle das Formular aus und sende es ab', send)).toBe(false);
    expect(hardToUndo('Fülle das Formular aus', send)).toBe(true);
  });

  it('sees a sign-in wall in a password field on screen', () => {
    const password = el({ role: 'textbox', label: 'Passwort', credential: true, editable: true });
    expect(showsLogin(input([password]))).toBe(true);
    expect(showsLogin(input([{ ...password, offscreen: true }]))).toBe(false);
  });

  it('offers neither covered elements nor a dropdown already set as asked', () => {
    const sort = el({
      role: 'combobox',
      tag: 'select',
      label: 'Sortieren nach',
      selectable: true,
      value: 'Name (A–Z)',
      options: ['Relevanz', 'Name (A–Z)', 'Preis'],
    });
    const covered = el({ role: 'button', label: 'Weiter', covered: true });
    const cookie = el({ role: 'button', label: 'Alle akzeptieren' });
    const other = el({ role: 'link', label: 'Start' });
    const { targets } = layaRound(
      input([sort, covered, cookie, other], { goal: 'Sortiere nach Name (A–Z) und klicke Weiter' }),
    );
    expect(targets.SELECT).toEqual([]);
    expect(targets.CLICK).not.toContain(covered);
    expect(targets.CLICK).toContain(cookie);
  });
});

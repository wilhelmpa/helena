// What changed between two observations, as a summary a decision model reads better than two raw
// lists: elements added, removed, changed (value, checked, active, sorted), reordered, the address,
// the numbers, and inserted text. Ported from jev-browser src/page-model.mjs (MIT, © Ying-Kai
// Liao), see NOTICE. Its notes: "Give Jev summaries code can compute, not raw lists to compare".

import { brief } from './policy-common.ts';
import type { PageElement, PageObservation } from './types.ts';

export interface PageDiff {
  added?: string[];
  removed?: string[];
  changed?: string[];
  reordered?: { before: string[]; after: string[] };
  url?: string;
  metrics?: Record<string, string>;
  new_text?: string;
}

// Word runs inserted in b relative to a (LCS over words), e.g. "walk the dog", "2 items".
export function insertedText(a: string, b: string, max = 300): string {
  const A = a.split(' ').slice(0, 600);
  const B = b.split(' ').slice(0, 600);
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const runs: string[] = [];
  let current: string[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && A[i] === B[j]) {
      if (current.length) {
        runs.push(current.join(' '));
        current = [];
      }
      i++;
      j++;
    } else if (i < n && dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      current.push(B[j]!);
      j++;
    }
  }
  if (current.length) runs.push(current.join(' '));
  return runs.join(' | ').slice(0, max);
}

function ident(element: PageElement): string {
  const own = element.label || element.text;
  return `${brief(element)}${element.near && element.near !== own ? ` near "${element.near.slice(0, 40)}"` : ''}`;
}

function state(element: PageElement): string {
  return [
    element.checked !== undefined ? `checked=${element.checked}` : '',
    element.value ? `value="${element.value}"` : '',
    element.active ? 'active' : '',
    element.sorted ? `sorted=${element.sorted}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function show(element: PageElement): string {
  const s = state(element);
  return `${ident(element)}${s ? ` ${s}` : ''}`;
}

export function pageDiff(a: PageObservation | null, b: PageObservation): PageDiff | undefined {
  if (!a) return undefined;
  const left = [...a.elements];
  const pairs: [PageElement, PageElement][] = [];
  const rest: PageElement[] = [];
  const diff: PageDiff = {};
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  // Pair elements: the same name and surrounding text first, then the same name in order.
  for (const element of b.elements) {
    const k = left.findIndex((x) => ident(x) === ident(element));
    if (k >= 0) pairs.push([left.splice(k, 1)[0]!, element]);
    else rest.push(element);
  }
  for (const element of rest) {
    const k = left.findIndex((x) => brief(x) === brief(element));
    if (k >= 0) pairs.push([left.splice(k, 1)[0]!, element]);
    else added.push(show(element));
  }
  for (const [old, element] of pairs) {
    if (state(old) !== state(element)) {
      changed.push(
        `${ident(element)}: ${state(old) || '(empty)'} -> ${state(element) || '(empty)'}`,
      );
    }
  }
  for (const element of left) removed.push(show(element));
  if (added.length) diff.added = added.slice(0, 15);
  if (removed.length) diff.removed = removed.slice(0, 15);
  if (changed.length) diff.changed = changed.slice(0, 15);
  if (!added.length && !removed.length) {
    // The same elements in another order (drag and drop, sorting): show the part that moved.
    const ka = a.elements.map(show);
    const kb = b.elements.map(show);
    const first = ka.findIndex((k, index) => k !== kb[index]);
    if (first >= 0 && ka.length === kb.length && !changed.length) {
      let last = ka.length - 1;
      while (last > first && ka[last] === kb[last]) last--;
      diff.reordered = {
        before: ka.slice(first, Math.min(last + 1, first + 10)),
        after: kb.slice(first, Math.min(last + 1, first + 10)),
      };
    }
  }
  if (a.url !== b.url) diff.url = `${a.url} -> ${b.url}`;
  for (const key of ['scrollY', 'pageHeight', 'textLength', 'elements'] as const) {
    if (a.metrics[key] !== b.metrics[key]) {
      (diff.metrics ??= {})[key] = `${a.metrics[key]} -> ${b.metrics[key]}`;
    }
  }
  const inserted = insertedText(a.text, b.text);
  if (inserted) diff.new_text = inserted;
  return diff;
}

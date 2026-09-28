'use client';

import { useCallback, useMemo } from 'react';
import { readLocal, useLocalValue, writeLocal } from './useLocalValue';

const DEFAULT_TABS = ['tool:chat'];

export function parseWorkspaceTabs(raw: string | null): string[] {
  if (!raw) return DEFAULT_TABS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return DEFAULT_TABS;
    const keys = value.filter(
      (entry): entry is string => typeof entry === 'string' && /^(tool|browser):.+$/.test(entry),
    );
    return [...new Set(keys)];
  } catch {
    return DEFAULT_TABS;
  }
}

export function orderWorkspaceTabs(available: string[], saved: string[]): string[] {
  const keys = new Set(available);
  return [...saved.filter((key) => keys.delete(key)), ...keys];
}

export function moveWorkspaceTab(keys: string[], from: string, to: string): string[] {
  const source = keys.indexOf(from);
  const target = keys.indexOf(to);
  if (source < 0 || target < 0 || source === target) return keys;
  const next = [...keys];
  next.splice(source, 1);
  next.splice(target, 0, from);
  return next;
}

export function syncBrowserTabs(current: string[], ids: string[]): string[] {
  return orderWorkspaceTabs(
    [
      ...current.filter((entry) => !entry.startsWith('browser:')),
      ...ids.map((id) => `browser:${id}`),
    ],
    current,
  );
}

export const workspaceTabsKey = (projectKey: string | null) =>
  `workspace:tabs:${projectKey ?? 'home'}`;

export function useWorkspaceTabs(projectKey: string | null) {
  const key = workspaceTabsKey(projectKey);
  const [raw] = useLocalValue(key);
  const saved = useMemo(() => parseWorkspaceTabs(raw), [raw]);
  const update = useCallback(
    (change: (current: string[]) => string[]) => {
      const current = parseWorkspaceTabs(readLocal(key));
      const next = change(current);
      if (JSON.stringify(current) !== JSON.stringify(next)) writeLocal(key, JSON.stringify(next));
    },
    [key],
  );
  const openTool = useCallback(
    (tool: string) =>
      update((current) => {
        const id = `tool:${tool}`;
        return current.includes(id) ? current : [...current, id];
      }),
    [update],
  );
  const close = useCallback(
    (id: string) => update((current) => current.filter((entry) => entry !== id)),
    [update],
  );
  const move = useCallback(
    (from: string, to: string, available: string[]) =>
      update((current) => moveWorkspaceTab(orderWorkspaceTabs(available, current), from, to)),
    [update],
  );
  const rememberBrowser = useCallback(
    (ids: string[]) => update((current) => syncBrowserTabs(current, ids)),
    [update],
  );
  return { saved, openTool, close, move, rememberBrowser };
}

'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useHydrated } from '@/components/common/page/useHydrated';
import { useSession } from '@/lib/auth-client';
import type { HomeDashboardPreference } from '@/lib/api/endpoints/userPreferences';
import {
  useAccountPreferencesQuery,
  useUpdateAccountPreferences,
} from '@/services/preferences.service';
import { useDashboardWidgets, type DashboardWidget } from '@/extensions/dashboardWidgets';
import { EMPTY_ARRANGEMENT, arrange, withDismissed, type Arranged } from './layout';

// The instance owner (the Administrator), read after hydration so the server render and
// the first client render agree.
export function useIsOwner(): boolean {
  const hydrated = useHydrated();
  const { data: session } = useSession();
  return hydrated && session?.user.role === 'god';
}

export interface HomeDashboard {
  // False until the reader's arrangement and role are known: Start shows placeholders
  // until then, so nothing jumps when they arrive.
  ready: boolean;
  owner: boolean;
  prefs: HomeDashboardPreference;
  // The widgets the reader may see, in the reader's order, each with whether it shows.
  figures: Arranged<DashboardWidget>[];
  sections: Arranged<DashboardWidget>[];
  save: (next: HomeDashboardPreference) => void;
}

export function useHomeDashboard(): HomeDashboard {
  const query = useAccountPreferencesQuery();
  const hydrated = useHydrated();
  const { isPending: sessionPending } = useSession();
  const owner = useIsOwner();
  const update = useUpdateAccountPreferences();
  const widgets = useDashboardWidgets();
  const prefs = query.data?.homeDashboard ?? EMPTY_ARRANGEMENT;
  const arranged = useMemo(
    () =>
      arrange(
        widgets.filter((widget) => widget.audience === 'everyone' || owner),
        prefs,
      ),
    [widgets, owner, prefs],
  );
  const { mutate } = update;
  const save = useCallback(
    (next: HomeDashboardPreference) =>
      mutate({
        homeDashboard: {
          ...next,
          chatAnimation: prefs.chatAnimation,
          chatFolders: prefs.chatFolders,
        },
      }),
    [mutate, prefs.chatAnimation, prefs.chatFolders],
  );
  return {
    ready: hydrated && !sessionPending && !query.isPending,
    owner,
    prefs,
    figures: arranged.filter((entry) => entry.widget.kind === 'figure'),
    sections: arranged.filter((entry) => entry.widget.kind === 'section'),
    save,
  };
}

// What a widget of Start may read about the page it sits on: whether the reader is the
// owner, the failures they hid, and the way to hide one more.
export interface HomeDashboardContext {
  owner: boolean;
  dismissed: ReadonlySet<string>;
  // Hides the failure `key`; `present` are the failure keys reported now (the hidden list
  // keeps only those).
  dismiss: (key: string, present: readonly string[]) => void;
}

const Ctx = createContext<HomeDashboardContext>({
  owner: false,
  dismissed: new Set(),
  dismiss: () => {},
});

export const HomeDashboardProvider = Ctx.Provider;

export function useHomeDashboardContext(): HomeDashboardContext {
  return useContext(Ctx);
}

// The context value for Start, from its arrangement.
export function useHomeDashboardValue(dashboard: HomeDashboard): HomeDashboardContext {
  const { owner, prefs, save } = dashboard;
  const dismissed = useMemo(() => new Set(prefs.dismissed), [prefs.dismissed]);
  const dismiss = useCallback(
    (key: string, present: readonly string[]) => save(withDismissed(prefs, key, present)),
    [prefs, save],
  );
  return useMemo(() => ({ owner, dismissed, dismiss }), [owner, dismissed, dismiss]);
}

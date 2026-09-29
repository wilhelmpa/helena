'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useIsMobile } from '@/hooks/use-mobile';
import type { OwnerTerminalKind } from '@/lib/api/endpoints/owner-terminal';
import {
  closeOwnerTerminalSession,
  endOwnerTerminalAuditSession,
  startOwnerTerminalAuditSession,
  useOwnerTerminalGrantQuery,
  useOwnerTerminalLocalModels,
} from './services/owner-terminal.service';
import StepUpDialog from './components/StepUpDialog';
import GrantBanner from './components/GrantBanner';
import TerminalTabBar from './components/TerminalTabBar';
import MobileKeyBar from './components/MobileKeyBar';
import { attachTerminalClipboard } from './utils/terminalClipboard';
import { terminalClipboardToasts } from './utils/terminalClipboardToasts';
import {
  addableKinds,
  DEFAULT_TABS,
  normalizeTabs,
  tabKey,
  visibleTabs,
  type OpenTerminalTab,
} from './utils/terminalTabs';
import { attachTerminalTheme } from '@/utils/terminalTheme';

export type { OpenTerminalTab } from './utils/terminalTabs';

// v3: Shell, Claude Code, Codex and Flash, each once (owner, 28.09., O26); older lists are
// read once and cleaned up (utils/terminalTabs.ts).
const STORAGE_KEY = 'owner-terminal:tabs:v3';
const OLDER_KEYS = ['owner-terminal:tabs:v2'];

// The list of open tabs is a per-browser convenience, not the source of truth:
// the tmux session a tab points at (owner-<kind>-<name> on the host) is what
// actually persists, and reopening the same kind with the same name from any
// device reconnects to it.
function loadTabs(): OpenTerminalTab[] {
  if (typeof window === 'undefined') return DEFAULT_TABS;
  try {
    for (const key of [STORAGE_KEY, ...OLDER_KEYS]) {
      const raw = window.localStorage.getItem(key);
      if (raw) return normalizeTabs(JSON.parse(raw));
    }
  } catch {
    // Unreadable: the defaults.
  }
  return DEFAULT_TABS;
}

// The owner terminal (Home -> Terminal): step-up gated, tmux-persisted Shell, Claude Code,
// Codex and Flash sessions. See
// docs/volition-design-owner-terminals.md. Registered for the "terminal" tool
// only in the Home context -- TerminalWorkspace renders the project terminal's
// plain iframe everywhere else.
export default function OwnerTerminalPanel() {
  const t = useTranslations('ownerTerminal');
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();
  const grant = useOwnerTerminalGrantQuery();
  const localModels = useOwnerTerminalLocalModels();
  const readyLocal = useMemo(
    () =>
      new Set<string>(
        (localModels.data ?? []).filter((model) => model.ready).map((model) => model.kind),
      ),
    [localModels.data],
  );
  const [tabs, setTabs] = useState<OpenTerminalTab[]>(DEFAULT_TABS);
  const [activeKey, setActiveKey] = useState('shell:main');
  const shown = useMemo(() => visibleTabs(tabs, readyLocal), [tabs, readyLocal]);
  // The tab to show: the chosen one, or the first visible one (Flash went away).
  const current = shown.some((tab) => tabKey(tab) === activeKey)
    ? activeKey
    : shown[0]
      ? tabKey(shown[0])
      : activeKey;
  const frames = useRef<Record<string, HTMLIFrameElement | null>>({});
  const area = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loaded = loadTabs();
    setTabs(loaded);
    setActiveKey(`${loaded[0]!.kind}:${loaded[0]!.name}`);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    if (!grant.data?.active) return;
    const [kind, name] = current.split(':') as [OwnerTerminalKind, string];
    void startOwnerTerminalAuditSession(kind, name);
  }, [current, grant.data?.active]);

  // xterm in each frame fits itself on its window's resize event. A frame hidden with
  // display:none measured nothing, and a panel resize or a tab switch does not always
  // resize the frame's window, so the terminal kept its old size (owner, 2026-09-24: "das
  // Terminal muss responsive die Fläche ausfüllen"). The active frame is told to fit on
  // every change of the area and of the tab.
  useEffect(() => {
    const fit = () => {
      try {
        frames.current[current]?.contentWindow?.dispatchEvent(new Event('resize'));
      } catch {
        // Not loaded yet; its own load fits it.
      }
    };
    const frame = requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    if (area.current) observer.observe(area.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [current, grant.data?.active]);

  // Copy and paste in every open terminal (owner, 2026-09-24: "ich muss copy paste
  // können im Terminal"); see utils/terminalClipboard.ts.
  useEffect(() => {
    if (!grant.data?.active) return;
    const notes = terminalClipboardToasts({
      copied: t('clipboard.copied'),
      pressToCopy: (keys) => t('clipboard.pressToCopy', { keys }),
    });
    const cleanups = Object.values(frames.current)
      .filter((frame): frame is HTMLIFrameElement => !!frame)
      .map((frame) => attachTerminalClipboard(frame, notes.copied, notes.pending));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [tabs, grant.data?.active, t]);

  useEffect(() => {
    if (!grant.data?.active) return;
    const cleanups = Object.values(frames.current)
      .filter((frame): frame is HTMLIFrameElement => !!frame)
      .map((frame) => attachTerminalTheme(frame, resolvedTheme === 'light' ? 'light' : 'dark'));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [tabs, grant.data?.active, resolvedTheme]);

  if (grant.isLoading) return null;
  if (!grant.data?.active) return <StepUpDialog onSuccess={() => grant.refetch()} />;

  function addTab(kind: OwnerTerminalKind) {
    setTabs((current) =>
      current.some((tab) => tab.kind === kind) ? current : [...current, { kind, name: 'main' }],
    );
    setActiveKey(`${kind}:main`);
  }

  function reorderTabs(fromKey: string, toKey: string) {
    setTabs((current) => {
      const keys = current.map((tab) => `${tab.kind}:${tab.name}`);
      const from = keys.indexOf(fromKey);
      const to = keys.indexOf(toKey);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }

  function closeTab(key: string) {
    const [kind, name] = key.split(':') as [OwnerTerminalKind, string];
    void endOwnerTerminalAuditSession(kind, name);
    // X ends the session for good, with the program in it, not only the tab.
    void closeOwnerTerminalSession(kind, name);
    setTabs((current) => {
      const next = current.filter((tab) => `${tab.kind}:${tab.name}` !== key);
      return next.length > 0 ? next : DEFAULT_TABS;
    });
    if (current === key) {
      const remaining = shown.filter((tab) => tabKey(tab) !== key);
      const fallback = remaining[0] ?? DEFAULT_TABS[0]!;
      setActiveKey(tabKey(fallback));
    }
  }


  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalTabBar
        tabs={shown}
        addable={addableKinds(tabs, readyLocal)}
        activeKey={current}
        onSelect={setActiveKey}
        onClose={closeTab}
        onReorder={reorderTabs}
        onAdd={addTab}
      />
      <GrantBanner expiresAt={grant.data.expiresAt} />
      <div ref={area} className="relative min-h-0 flex-1">
        {shown.map((tab) => {
          const key = tabKey(tab);
          return (
            <iframe
              key={key}
              ref={(el) => {
                frames.current[key] = el;
              }}
              src={`/focus/owner-terminal/${tab.kind}/${tab.name}/`}
              title={`${t(`kinds.${tab.kind}`)} ${tab.name}`}
              loading="lazy"
              className="ds-terminal-frame"
              data-active={key === current ? 'true' : 'false'}
              allow="clipboard-read; clipboard-write"
              onLoad={(event) =>
                event.currentTarget.contentWindow?.dispatchEvent(new Event('resize'))
              }
            />
          );
        })}
      </div>
      {isMobile && <MobileKeyBar frame={frames.current[current] ?? null} />}
    </div>
  );
}

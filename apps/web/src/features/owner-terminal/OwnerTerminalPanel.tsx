'use client';

import { useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { OwnerTerminalKind } from '@/lib/api/endpoints/owner-terminal';
import {
  closeOwnerTerminalSession,
  endOwnerTerminalAuditSession,
  startOwnerTerminalAuditSession,
  useOwnerTerminalGrantQuery,
} from './services/owner-terminal.service';
import StepUpDialog from './components/StepUpDialog';
import GrantBanner from './components/GrantBanner';
import TerminalTabBar from './components/TerminalTabBar';
import MobileKeyBar from './components/MobileKeyBar';
import { attachTerminalClipboard } from './utils/terminalClipboard';
import { terminalClipboardToasts } from './utils/terminalClipboardToasts';
import { attachTerminalTheme } from '@/utils/terminalTheme';

export interface OpenTerminalTab {
  kind: OwnerTerminalKind;
  name: string;
}

// v2: Shell, Claude Code and Codex are open from the start (owner, 2026-09-24);
// the new key drops the Shell-only lists v1 saved before that.
const STORAGE_KEY = 'owner-terminal:tabs:v2';
const DEFAULT_TABS: OpenTerminalTab[] = [
  { kind: 'shell', name: 'main' },
  { kind: 'claude', name: 'main' },
  { kind: 'codex', name: 'main' },
];

// The list of open tabs is a per-browser convenience, not the source of truth:
// the tmux session a tab points at (owner-<kind>-<name> on the host) is what
// actually persists, and reopening the same kind with the same name from any
// device reconnects to it. Restoring the same *list* of tabs automatically only
// works on the browser that opened them.
function loadTabs(): OpenTerminalTab[] {
  if (typeof window === 'undefined') return DEFAULT_TABS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OpenTerminalTab[]) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TABS;
  } catch {
    return DEFAULT_TABS;
  }
}

function nextName(tabs: OpenTerminalTab[], kind: OwnerTerminalKind): string {
  const taken = new Set(tabs.filter((tab) => tab.kind === kind).map((tab) => tab.name));
  if (!taken.has('main')) return 'main';
  for (let n = 2; ; n += 1) if (!taken.has(`main-${n}`)) return `main-${n}`;
}

// The owner terminal (Home -> Terminal): step-up gated, tmux-persisted Shell,
// Claude Code, Codex and Helena-dev sessions. See
// docs/volition-design-owner-terminals.md. Registered for the "terminal" tool
// only in the Home context -- TerminalWorkspace renders the project terminal's
// plain iframe everywhere else.
export default function OwnerTerminalPanel() {
  const t = useTranslations('ownerTerminal');
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();
  const grant = useOwnerTerminalGrantQuery();
  const [tabs, setTabs] = useState<OpenTerminalTab[]>(DEFAULT_TABS);
  const [activeKey, setActiveKey] = useState('shell:main');
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
    const [kind, name] = activeKey.split(':') as [OwnerTerminalKind, string];
    void startOwnerTerminalAuditSession(kind, name);
  }, [activeKey, grant.data?.active]);

  // xterm in each frame fits itself on its window's resize event. A frame hidden with
  // display:none measured nothing, and a panel resize or a tab switch does not always
  // resize the frame's window, so the terminal kept its old size (owner, 2026-09-24: "das
  // Terminal muss responsive die Fläche ausfüllen"). The active frame is told to fit on
  // every change of the area and of the tab.
  useEffect(() => {
    const fit = () => {
      try {
        frames.current[activeKey]?.contentWindow?.dispatchEvent(new Event('resize'));
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
  }, [activeKey, grant.data?.active]);

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
    const name = nextName(tabs, kind);
    setTabs((current) => [...current, { kind, name }]);
    setActiveKey(`${kind}:${name}`);
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
    if (activeKey === key) {
      const remaining = tabs.filter((tab) => `${tab.kind}:${tab.name}` !== key);
      const fallback = remaining[0] ?? DEFAULT_TABS[0]!;
      setActiveKey(`${fallback.kind}:${fallback.name}`);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GrantBanner expiresAt={grant.data.expiresAt} />
      <TerminalTabBar
        tabs={tabs}
        activeKey={activeKey}
        onSelect={setActiveKey}
        onClose={closeTab}
        onReorder={reorderTabs}
        onAdd={addTab}
      />
      <div ref={area} className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const key = `${tab.kind}:${tab.name}`;
          return (
            <iframe
              key={key}
              ref={(el) => {
                frames.current[key] = el;
              }}
              src={`/focus/owner-terminal/${tab.kind}/${tab.name}/`}
              title={`${t(`kinds.${tab.kind}`)} ${tab.name}`}
              loading="lazy"
              className={cn(
                'absolute inset-0 h-full w-full rounded-b-lg border-0 bg-background',
                key !== activeKey && 'pointer-events-none invisible',
              )}
              allow="clipboard-read; clipboard-write"
              onLoad={(event) =>
                event.currentTarget.contentWindow?.dispatchEvent(new Event('resize'))
              }
            />
          );
        })}
      </div>
      {isMobile && <MobileKeyBar frame={frames.current[activeKey] ?? null} />}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceContents } from '@/context/workspaceContents';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePersistedWidth } from '@/hooks/usePersistedWidth';
import type { WorkspacePanelMode } from '@/hooks/useWorkspacePanel';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import { workspaceTools } from '@/utils/workspaceTools';
import { cn } from '@/lib/utils';
import ResizeGrip from '@/components/common/ResizeGrip';
import WorkspaceFrame from './WorkspaceFrame';
import WorkspacePanelHeader from './WorkspacePanelHeader';
import WorkspaceUnavailable from './WorkspaceUnavailable';

const DEFAULT_WIDTH = 620;
const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
const BROWSER_LOSSLESS_STORAGE_KEY = 'workspace:browser:lossless';

function browserStreamUrl(url: string, lossless: boolean) {
  const parsed = new URL(url);
  if (lossless) parsed.searchParams.set('stream', 'lossless');
  else parsed.searchParams.delete('stream');
  return parsed.toString();
}

export default function WorkspacePanel({
  open,
  activeTool,
  contextProjectKey,
  toolSession,
  mode,
  fullscreen,
  onToggleMode,
  onToggleFullscreen,
  onClose,
}: {
  open: boolean;
  activeTool: WorkspaceToolId;
  contextProjectKey: string | null;
  toolSession: number;
  mode: WorkspacePanelMode;
  fullscreen: boolean;
  onToggleMode: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('nav.workspace');
  const tChat = useTranslations('aiChat');
  const direction = Direction.useDirection();
  const isMobile = useIsMobile();
  const { width, setWidth } = usePersistedWidth(
    'workspace:panel:width',
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
  );
  const workspaceConfig = runtimeEnv().workspace;
  const provisioning = useProjectProvisioningQuery(contextProjectKey);
  const provisionedResources = useMemo(
    () =>
      provisioning.data?.status === 'succeeded' ? (provisioning.data.result?.resources ?? []) : [],
    [provisioning.data],
  );
  const tools = useMemo(
    () => workspaceTools(workspaceConfig, contextProjectKey, provisionedResources),
    [contextProjectKey, provisionedResources, workspaceConfig],
  );
  const tool = tools[activeTool];
  const contents = useWorkspaceContents();
  const RegisteredContent = contents[activeTool];
  const labels: Record<WorkspaceToolId, string> = {
    chat: t('chat'),
    terminal: t('terminal'),
    code: t('code'),
    browser: t('browser'),
    files: t('files'),
    inbox: t('inbox'),
    mail: t('mail'),
    connections: t('connections'),
  };
  const [advanced, setAdvanced] = useState(false);
  const Content = activeTool === 'chat' && advanced ? undefined : RegisteredContent;
  const [browserLossless, setBrowserLossless] = useState(false);
  const [browserPreferenceReady, setBrowserPreferenceReady] = useState(false);
  const [frames, setFrames] = useState<
    { key: string; url: string; title: string; tool: WorkspaceToolId }[]
  >([]);
  const [frameReloads, setFrameReloads] = useState<Record<string, number>>({});
  const [visitedContents, setVisitedContents] = useState<WorkspaceToolId[]>([]);
  const activeUrl = useMemo(() => {
    if (activeTool === 'chat' && advanced) return tool.advancedUrl;
    if (activeTool !== 'browser' || !tool.url) return tool.url;
    if (!browserPreferenceReady) return null;
    return browserStreamUrl(tool.url, browserLossless);
  }, [activeTool, advanced, browserLossless, browserPreferenceReady, tool]);
  const frameKey = `${activeTool}:${
    activeTool === 'browser' ? `${tool.url}:${toolSession}` : activeUrl
  }`;
  const activeLabel = labels[activeTool];
  useEffect(() => setAdvanced(false), [activeTool, contextProjectKey]);
  useEffect(() => {
    try {
      setBrowserLossless(localStorage.getItem(BROWSER_LOSSLESS_STORAGE_KEY) === 'true');
    } catch {
      setBrowserLossless(false);
    } finally {
      setBrowserPreferenceReady(true);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    if (Content) {
      setVisitedContents((current) =>
        current.includes(activeTool) ? current : [...current, activeTool],
      );
      return;
    }
    if (!activeUrl) return;
    setFrames((current) => {
      const existing = current.find((frame) => frame.key === frameKey);
      if (existing?.url === activeUrl && existing.title === activeLabel) return current;
      const nextFrame = {
        key: frameKey,
        url: activeUrl,
        title: activeLabel,
        tool: activeTool,
      };
      const remaining = current.filter(
        (frame) => frame.key !== frameKey && (activeTool !== 'browser' || frame.tool !== 'browser'),
      );
      return [...remaining, nextFrame].slice(-4);
    });
  }, [activeTool, activeLabel, open, activeUrl, frameKey, Content]);

  const overlay = isMobile || mode === 'overlay';
  const title = advanced ? t('advanced') : labels[activeTool];

  return (
    <aside
      aria-label={title}
      className={cn(
        'flex h-full min-h-0 flex-col bg-background',
        !open && 'hidden',
        fullscreen
          ? 'fixed inset-0 z-50'
          : cn(
              'border-s',
              overlay
                ? 'absolute inset-y-0 end-0 z-30 shadow-[var(--side-panel-shadow)]'
                : 'relative shrink-0',
            ),
      )}
      style={fullscreen ? undefined : { width: isMobile ? '100%' : width }}
    >
      {!isMobile && !fullscreen && (
        <ResizeGrip
          label={tChat('resizePanel')}
          className="absolute inset-y-0 start-0 z-10"
          onDrag={(deltaX) => setWidth(width + (direction === 'rtl' ? deltaX : -deltaX))}
        />
      )}

      <WorkspacePanelHeader
        title={title}
        advanced={advanced}
        canExpandChat={activeTool === 'chat' && !!tool.advancedUrl}
        canToggleBrowserLossless={activeTool === 'browser' && !!tool.url && browserPreferenceReady}
        browserLossless={browserLossless}
        externalUrl={Content ? null : activeUrl}
        isMobile={isMobile}
        fullscreen={fullscreen}
        mode={mode}
        onToggleAdvanced={() => setAdvanced((current) => !current)}
        onToggleBrowserLossless={() =>
          setBrowserLossless((current) => {
            const next = !current;
            try {
              localStorage.setItem(BROWSER_LOSSLESS_STORAGE_KEY, String(next));
            } catch {
              // The current view can still use the selected mode without persistent storage.
            }
            return next;
          })
        }
        onToggleMode={onToggleMode}
        onToggleFullscreen={onToggleFullscreen}
        onReload={() =>
          setFrameReloads((current) => ({
            ...current,
            [frameKey]: (current[frameKey] ?? 0) + 1,
          }))
        }
        onClose={onClose}
      />

      {frames.map((frame) => (
        <WorkspaceFrame
          key={frame.key}
          url={frame.url}
          title={frame.title}
          tool={frame.tool}
          active={open && !Content && frame.key === frameKey}
          reloadToken={frameReloads[frame.key] ?? 0}
        />
      ))}
      {visitedContents.map((id) => {
        const ToolContent = contents[id];
        return ToolContent ? (
          <div
            key={`${id}:${contextProjectKey ?? 'global'}`}
            className={cn(
              'min-h-0 flex-1 overflow-hidden',
              (!open || activeTool !== id || (id === 'chat' && advanced)) && 'hidden',
            )}
          >
            <ToolContent projectKey={contextProjectKey} />
          </div>
        ) : null;
      })}
      {open && !Content && !activeUrl && (activeTool !== 'browser' || browserPreferenceReady) && (
        <WorkspaceUnavailable tool={labels[activeTool]} />
      )}
    </aside>
  );
}

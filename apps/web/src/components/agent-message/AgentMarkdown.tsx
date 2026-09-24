'use client';

import { useEffect, useMemo, useReducer, type AnchorHTMLAttributes, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  type AnimateOptions,
  type Components,
  type ControlsConfig,
  type CustomRenderer,
  type CustomRendererProps,
  type ExtraProps,
  type PluginConfig,
  type StreamdownTranslations,
} from 'streamdown';
import { cn } from '@/lib/utils';
import { linkFileMarkers, parseImportRef } from '@/lib/markdown';
import { parseChartSpec } from '@/utils/chartSpec';
import { installClipboardFallback } from '@/utils/clipboard';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageResponse,
  MessageResponseProvider,
  type MessageResponseProps,
} from '@/components/ai-elements/message';

// recharts and the import card load only for the answers that carry one.
const ChartBlock = dynamic(() => import('@/components/common/chart/ChartBlock'));
const AgentChatImportCard = dynamic(
  () => import('@/components/common/agent-chat/AgentChatImportCard'),
);

// How an agent's Markdown is rendered everywhere Helena shows it: Streamdown (through AI
// Elements' MessageResponse) with Shiki for code and Mermaid for diagrams — each loaded
// the first time an answer needs it —, Helena's own fences drawn as what they stand for
// (```chart, ```issue-import), links inside Helena opened in place and the rest in a new
// tab, and the controls of code blocks, tables and diagrams in the reader's language.

type Plugin = 'code' | 'mermaid';
const loaded: Pick<PluginConfig, Plugin> = {};
const pending = new Set<Plugin>();
const listeners = new Set<() => void>();

function loadPlugin(kind: Plugin) {
  if (loaded[kind] || pending.has(kind)) return;
  pending.add(kind);
  const load =
    kind === 'code'
      ? import('@streamdown/code').then((module) => {
          loaded.code = module.code;
        })
      : import('@streamdown/mermaid').then((module) => {
          loaded.mermaid = module.mermaid;
        });
  void load
    .catch(() => undefined)
    .finally(() => {
      pending.delete(kind);
      for (const listener of listeners) listener();
    });
}

// Any fenced block needs the highlighter; a ```mermaid one the diagram renderer too.
export function pluginsNeeded(source: string): { code: boolean; mermaid: boolean } {
  return {
    code: /(^|\n)\s*(```|~~~)/.test(source),
    mermaid: /(^|\n)\s*(```|~~~)\s*mermaid\b/i.test(source),
  };
}

function useLazyPlugins(source: string) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const needs = pluginsNeeded(source);
  useEffect(() => {
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);
  useEffect(() => {
    if (needs.code) loadPlugin('code');
    if (needs.mermaid) loadPlugin('mermaid');
  }, [needs.code, needs.mermaid]);
  return {
    code: needs.code ? loaded.code : undefined,
    mermaid: needs.mermaid ? loaded.mermaid : undefined,
  };
}

// A code block as Streamdown draws it, for a fence a renderer below claimed but could
// not use (a ```json block that is not a chart, a broken import fence).
function PlainCodeBlock({ code, language, isIncomplete }: CustomRendererProps) {
  return (
    <CodeBlock code={code} language={language} isIncomplete={isIncomplete} lineNumbers={false}>
      <CodeBlockDownloadButton code={code} language={language} />
      <CodeBlockCopyButton />
    </CodeBlock>
  );
}

const PendingBlock = () => <Skeleton className="my-3 h-[220px] w-full" />;

// A chart the create_chart tool specified, placed in the text as a ```chart fence. A
// model does not always tag it, so a ```json fence that parses as a chart is one too.
function ChartFence(props: CustomRendererProps) {
  const spec = useMemo(
    () => (props.isIncomplete ? null : parseChartSpec(props.code)),
    [props.code, props.isIncomplete],
  );
  if (spec) return <ChartBlock spec={spec} source={props.code} />;
  if (props.isIncomplete && props.language === 'chart') return <PendingBlock />;
  return <PlainCodeBlock {...props} />;
}

// The review card of an import the agent drafted. Only the id is read from the text;
// the card loads the draft itself, so extra JSON around it cannot forge rows.
function ImportFence(props: CustomRendererProps) {
  const importId = props.isIncomplete ? null : parseImportRef(props.code);
  if (importId) return <AgentChatImportCard importId={importId} />;
  if (props.isIncomplete) return <PendingBlock />;
  return <PlainCodeBlock {...props} />;
}

const HELENA_RENDERERS: CustomRenderer[] = [
  { language: ['chart', 'json'], component: ChartFence },
  { language: 'issue-import', component: ImportFence },
];

const LINK_CLASS = 'wrap-anywhere font-medium text-brand underline underline-offset-2';

// A place inside Helena opens in place (the chat panel stays open beside it; the kiosk
// has no tabs to open one in); anything else in a new tab.
function internalPath(href: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

function AgentLink({
  href,
  children,
  className,
  node: _node,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  if (!href || href === 'streamdown:incomplete-link') {
    return <span className={cn(LINK_CLASS, className)}>{children}</span>;
  }
  const path = internalPath(href);
  if (path) {
    return (
      <Link href={path} className={cn(LINK_CLASS, className)}>
        {children}
      </Link>
    );
  }
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(LINK_CLASS, className)}
    >
      {children}
    </a>
  );
}

const COMPONENTS: Components = { a: AgentLink };

const CONTROLS: ControlsConfig = {
  code: { copy: true, download: true },
  table: { copy: true, download: true, fullscreen: true },
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
  image: { download: true },
};

// New words fade in as they arrive, so the runner's batches read as one stream.
export const STREAMING_ANIMATION: AnimateOptions = {
  animation: 'fadeIn',
  duration: 180,
  sep: 'word',
};

const TRANSLATION_KEYS = [
  'close',
  'copied',
  'copyCode',
  'copyTable',
  'copyTableAsCsv',
  'copyTableAsMarkdown',
  'copyTableAsTsv',
  'downloadDiagram',
  'downloadDiagramAsMmd',
  'downloadDiagramAsPng',
  'downloadDiagramAsSvg',
  'downloadFile',
  'downloadImage',
  'downloadTable',
  'downloadTableAsCsv',
  'downloadTableAsMarkdown',
  'exitFullscreen',
  'imageNotAvailable',
  'resetView',
  'viewFullscreen',
  'zoomIn',
  'zoomOut',
] as const satisfies readonly (keyof StreamdownTranslations)[];

export interface AgentMarkdownProviderProps {
  // The Markdown rendered below (all of a message's text), to know which plugins to load.
  source: string;
  // Fences a caller draws itself, before Helena's own (the chat's artifact cards).
  renderers?: CustomRenderer[];
  children: ReactNode;
}

// Sets up every MessageResponse below it — the answer, its reasoning, its tool calls —
// the same way.
export function AgentMarkdownProvider({ source, renderers, children }: AgentMarkdownProviderProps) {
  const t = useTranslations('common.agentChat.markdown');
  const { resolvedTheme } = useTheme();
  const { code, mermaid } = useLazyPlugins(source);

  useEffect(() => installClipboardFallback(), []);

  const plugins = useMemo<PluginConfig>(
    () => ({
      ...(code ? { code } : {}),
      ...(mermaid ? { mermaid } : {}),
      renderers: [...(renderers ?? []), ...HELENA_RENDERERS],
    }),
    [code, mermaid, renderers],
  );
  const translations = useMemo(
    () => Object.fromEntries(TRANSLATION_KEYS.map((key) => [key, t(key)])),
    [t],
  );
  const mermaidOptions = useMemo(
    () => ({ config: { theme: resolvedTheme === 'dark' ? 'dark' : 'default' } }),
    [resolvedTheme],
  );

  const defaults = useMemo<Omit<MessageResponseProps, 'children'>>(
    () => ({
      className: 'agent-markdown',
      dir: 'auto',
      plugins,
      components: COMPONENTS,
      controls: CONTROLS,
      translations,
      mermaid: mermaidOptions,
      // Agents are the reader's own; their links need no "leave Helena?" dialog.
      linkSafety: { enabled: false },
      // No math renderer is loaded, so `$$` (a shell's `$$`, jQuery's `$$eval`) is never
      // "completed" into a formula while an answer streams.
      remend: { katex: false },
      codeBlockMaxHeight: 480,
      tableMaxHeight: 480,
    }),
    [plugins, translations, mermaidOptions],
  );

  return <MessageResponseProvider value={defaults}>{children}</MessageResponseProvider>;
}

export interface AgentTextProps {
  children: string;
  // Still being written: incomplete Markdown is closed while it streams, and new words
  // fade in.
  streaming?: boolean;
  className?: string;
}

// One stretch of an agent's text. Must sit inside an AgentMarkdownProvider.
export function AgentText({ children, streaming = false, className }: AgentTextProps) {
  const text = useMemo(() => linkFileMarkers(children), [children]);
  return (
    <MessageResponse
      isAnimating={streaming}
      animated={streaming ? STREAMING_ANIMATION : undefined}
      // Unfinished Markdown is closed only while it is still being written; a finished
      // answer is shown exactly as the agent wrote it.
      parseIncompleteMarkdown={streaming}
      className={className}
    >
      {text}
    </MessageResponse>
  );
}

// Markdown an agent wrote, on its own (outside a message).
export function AgentMarkdown({
  children,
  streaming,
  renderers,
  className,
}: AgentTextProps & { renderers?: CustomRenderer[] }) {
  return (
    <AgentMarkdownProvider source={children} renderers={renderers}>
      <AgentText streaming={streaming} className={className}>
        {children}
      </AgentText>
    </AgentMarkdownProvider>
  );
}

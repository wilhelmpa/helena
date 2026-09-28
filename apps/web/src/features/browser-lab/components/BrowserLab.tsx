'use client';

import Link from 'next/link';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ExternalLink, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import WorkspaceBrowserLive from '@/components/layout/WorkspaceBrowserLive';
import { useBrowserPreferences } from '@/hooks/useBrowserPreferences';
import type { LabRun, LabScope } from '@/lib/api/endpoints/browserTask';
import { BROWSER_ROUTER_BASE } from '@/utils/browserOverview';
import { accessPath, chatPath } from '@/utils/paths';
import {
  useCancelLabRun,
  useLabOptionsQuery,
  useLabRunQuery,
  useLabRunsQuery,
  useStartLabRun,
} from '../services/browserTask.service';
import { emptyDraft, toStartRun, type LabDraft } from '../utils/lab';
import { LabForm } from './LabForm';
import { LabRunPanel } from './LabRunPanel';
import { LabRunsTable } from './LabRunsTable';

// The live view's control base for a project browser by its slug, on this origin (the browser
// router is served under /browser next to the app). The origin is only known in the browser.
function liveBase(origin: string, slug: string): string {
  return `${origin}${BROWSER_ROUTER_BASE}/projects/${encodeURIComponent(slug)}/api`;
}
const noSubscription = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => null;

// When no decision model is set up yet: where the key goes, and the two ways to get one.
function NoKey() {
  const t = useTranslations('browserLab.noKey');
  return (
    <div className="space-y-3 rounded-md border border-sidebar-border bg-card p-4">
      <p className="text-sm font-medium">{t('title')}</p>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
      <ul className="space-y-1 text-sm">
        <li>
          <a
            href="https://console.typesafe.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {t('typesafe')}
          </a>
        </li>
        <li>
          <a
            href="https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {t('vercel')}
          </a>
        </li>
      </ul>
      <Button asChild variant="outline" size="sm">
        <Link href={accessPath('credentials')}>
          <KeyRound />
          {t('toAccess')}
        </Link>
      </Button>
    </div>
  );
}

// Browser 2.0 (docs/helena-decisions/browser-task.md §3.5): a task, the backend to run it with
// (Standard as before, a decision model through the gateway, or jev-browser for comparison), the
// project browser's live view next to it ("Übernehmen" works as everywhere), the steps as they
// happen, and every run so far to compare.
export default function BrowserLab({ scope }: { scope: LabScope }) {
  const t = useTranslations('browserLab');
  const options = useLabOptionsQuery(scope);
  const runs = useLabRunsQuery(scope);
  const start = useStartLabRun(scope);
  const cancel = useCancelLabRun(scope);
  // The form as the reader changed it; until then the defaults of the options.
  const [edited, setEdited] = useState<LabDraft | null>(null);
  const draft = edited ?? (options.data ? emptyDraft(options.data) : null);
  // The run shown; until one is picked, the newest.
  const [chosen, setChosen] = useState<number | null>(null);
  const selected = chosen ?? runs.data?.runs[0]?.id ?? null;
  const run = useLabRunQuery(scope, selected);
  const { followAgent } = useBrowserPreferences();
  const origin = useSyncExternalStore(noSubscription, clientOrigin, serverOrigin);
  const slug = options.data?.slug ?? null;
  const base = origin && slug ? liveBase(origin, slug) : null;

  const defaults = options.data;
  const change = useCallback(
    (patch: Partial<LabDraft>) => {
      setEdited((current) => {
        const from = current ?? (defaults ? emptyDraft(defaults) : null);
        return from ? { ...from, ...patch } : current;
      });
    },
    [defaults],
  );

  if (options.isPending || !options.data || !draft) {
    return <ListSkeleton rows={3} rowClassName="h-24" />;
  }

  const execute = (next: LabDraft) => {
    const body = toStartRun(next);
    if (!body) return;
    start.mutate(body, { onSuccess: (created) => setChosen(created.id) });
  };

  const rerun = (previous: LabRun) => {
    // The same task again; the reader picks another backend in the form, then runs it.
    const values = previous.valueKeys.length ? draft.values : '';
    setEdited({
      ...draft,
      goal: previous.goal,
      startUrl: previous.startUrl ?? '',
      mode: previous.mode === 'read' ? 'read' : 'act',
      maxSteps: String(previous.maxSteps),
      values,
    });
    document.getElementById('lab-goal')?.focus();
  };

  const current = run.data ?? null;
  const showLive = base !== null && current?.backend !== 'jev-browser';
  const noConnections = options.data.connections.length === 0;
  const projectKey = scope.kind === 'project' ? scope.projectKey : null;

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <div className="min-w-0 space-y-4">
        {noConnections && <NoKey />}
        {options.data.agents.length === 0 ? (
          <p className="rounded-md border border-sidebar-border bg-card p-4 text-sm text-muted-foreground">
            {t('noAgents')}
          </p>
        ) : (
          <div className="rounded-md border border-sidebar-border bg-card p-4">
            <LabForm
              options={options.data}
              draft={draft}
              onChange={change}
              onRun={() => execute(draft)}
              running={start.isPending}
              canStandard={scope.kind === 'project'}
            />
          </div>
        )}
        {current && (
          <div className="rounded-md border border-sidebar-border bg-card p-4">
            <LabRunPanel
              run={current}
              chatHref={
                current.chatThreadId && projectKey
                  ? chatPath(projectKey, { agent: current.agentId, thread: current.chatThreadId })
                  : null
              }
              cancelling={cancel.isPending}
              onCancel={() => cancel.mutate(current.id)}
              onRerun={() => rerun(current)}
            />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {showLive && (
          <div className="flex h-[min(70vh,44rem)] min-h-80 flex-col overflow-hidden rounded-md border border-sidebar-border bg-card">
            <WorkspaceBrowserLive
              base={base}
              active
              reloadToken={0}
              followAgent={followAgent}
              className="flex-1"
            />
          </div>
        )}
        <section className="space-y-2">
          <h2 className="text-md font-medium">{t('table.title')}</h2>
          <LabRunsTable runs={runs.data?.runs ?? []} selected={selected} onSelect={setChosen} />
        </section>
      </div>
    </div>
  );
}

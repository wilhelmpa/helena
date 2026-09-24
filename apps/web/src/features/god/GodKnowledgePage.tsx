'use client';

import { RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  useKnowledgeSourcesQuery,
  useReindexSourceMutation,
  useSemanticSearchMutation,
} from '@/services/everything.service';
import GodSectionPage from './components/GodSectionPage';

const KNOWN_SOURCES = ['issue', 'comment', 'vault', 'mail', 'chat', 'run'] as const;

// Administrator → Wissen & Suche: the knowledge sources the one search covers (Helena's
// own and those of plugins), how far the index is with each, and the switch for semantic
// search with what it still needs (pgvector, the embedding model: owner decisions, see
// docs/helena-decisions/second-brain.md).
export default function GodKnowledgePage() {
  const t = useTranslations('knowledge.admin');
  const tSource = useTranslations('knowledge.source');
  const format = useFormatter();
  const sources = useKnowledgeSourcesQuery();
  const reindex = useReindexSourceMutation();
  const semantic = useSemanticSearchMutation();
  const status = semantic.data ?? sources.data?.semantic;
  const switchedOn = status ? status.enabled || status.problem !== null : false;

  const labelOf = (id: string) =>
    (KNOWN_SOURCES as readonly string[]).includes(id)
      ? tSource(id as (typeof KNOWN_SOURCES)[number])
      : id;

  return (
    <GodSectionPage slug="knowledge">
      <SettingsSection title={t('sources')} description={t('sourcesHint')}>
        <SettingsCard className="divide-y">
          {(sources.data?.sources ?? []).map((source) => (
            <div key={source.id} className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{labelOf(source.id)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {source.lastError
                    ? t('error', { message: source.lastError })
                    : source.lastRunAt
                      ? t('indexedAt', {
                          time: format.relativeTime(new Date(source.lastRunAt)),
                        })
                      : t('notYet')}
                  {source.pluginId && source.pluginId !== 'helena.knowledge'
                    ? ` · ${source.pluginId}`
                    : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('items', { count: source.items })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                disabled={reindex.isPending}
                onClick={() => reindex.mutate(source.id)}
                title={t('reindex')}
                aria-label={t('reindex')}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('semantic')} description={t('semanticHint')}>
        <SettingsCard className="space-y-3 p-4 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span>{t('semanticSwitch')}</span>
            <Switch
              checked={switchedOn}
              disabled={!status || semantic.isPending}
              onCheckedChange={(enabled) => semantic.mutate(enabled)}
            />
          </label>
          {status && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('pgvector')}</dt>
              <dd>{status.pgvector ? t('installed') : t('notInstalled')}</dd>
              <dt className="text-muted-foreground">{t('model')}</dt>
              <dd className="truncate">{status.model ?? t('none')}</dd>
              <dt className="text-muted-foreground">{t('passages')}</dt>
              <dd className="tabular-nums">
                {t('embedded', { embedded: status.embedded, passages: status.passages })}
              </dd>
            </dl>
          )}
          {status?.problem && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs">
              {status.problem === 'runtime-missing' ? t('runtimeMissing') : t('modelMissing')}
            </p>
          )}
        </SettingsCard>
      </SettingsSection>
    </GodSectionPage>
  );
}

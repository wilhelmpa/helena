'use client';

import { useState } from 'react';
import { FlaskConical, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  LocalAiClass,
  LocalAiEval,
  LocalAiMode,
  LocalAiPreset,
  LocalAiSettings,
  ModelServer,
  ServerInput,
} from '@/lib/api/endpoints/localAi';
import { formatDateTime } from '@/utils/dates';
import {
  useCheckModelServer,
  useCreateModelServer,
  useDeleteModelServer,
  useLocalAiSettings,
  useRunLocalAiEval,
  useUpdateLocalAiPolicy,
  useUpdateModelServer,
} from '../services/localAi.service';
import { gib, resolveLabel, shortModel } from '../utils/localAi';
import LocalAiCard from './LocalAiCard';

const MODES: LocalAiMode[] = ['off', 'prefer', 'only'];
const PRESETS: LocalAiPreset[] = ['sparsam', 'ausgewogen', 'qualitaet', 'eigene'];
const AUTO = '__auto__';

// Lokale KI in full (Administrator; hub/server-admin mounts it in Administrator → Server): the
// card, the model servers and their models, each kind of work with its mode, model and eval,
// and the presets. The owner decides; a class leaves "Aus" only once its eval passed.
export default function LocalAiSettingsView() {
  const t = useTranslations('localAi');
  const settings = useLocalAiSettings();
  const data = settings.data;

  return (
    <div className="flex flex-col gap-6">
      <LocalAiCard />
      {!data ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : (
        <>
          <ServersSection settings={data} />
          <PresetSection settings={data} />
          <SettingsSection title={t('classesTitle')} description={t('classesDescription')}>
            <SettingsCard className="divide-y">
              {data.classes.map((entry) => (
                <ClassRow key={entry.id} entry={entry} settings={data} />
              ))}
            </SettingsCard>
          </SettingsSection>
        </>
      )}
    </div>
  );
}

function ServersSection({ settings }: { settings: LocalAiSettings }) {
  const t = useTranslations('localAi.servers');
  const [adding, setAdding] = useState(false);
  return (
    <SettingsSection
      title={t('title')}
      description={t('description')}
      action={
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus />
          {t('add')}
        </Button>
      }
    >
      {settings.servers.length === 0 ? (
        <SettingsCard className="p-4 text-sm text-muted-foreground">{t('none')}</SettingsCard>
      ) : (
        settings.servers.map((server) => <ServerCard key={server.id} server={server} />)
      )}
      <ServerDialog open={adding} onOpenChange={setAdding} settings={settings} />
    </SettingsSection>
  );
}

function ServerCard({ server }: { server: ModelServer }) {
  const t = useTranslations('localAi.servers');
  const tUnits = useTranslations('localAi.units');
  const check = useCheckModelServer();
  const update = useUpdateModelServer();
  const remove = useDeleteModelServer();
  const onError = (error: Error) => toast.error(error.message);
  const reachable = server.status?.reachable ?? false;
  return (
    <SettingsCard className="divide-y">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 font-medium">
            {server.name}
            <StatusBadge status={reachable ? 'success' : 'danger'} className="text-xs">
              {!reachable
                ? t('unreachable')
                : server.status?.version
                  ? t('reachable', { version: server.status.version })
                  : t('reachableBare')}
            </StatusBadge>
          </div>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {server.baseUrl} · {server.provider} · {t(`keys.${server.key}`)} ·{' '}
            {t('context', { tokens: server.contextLength })}
          </p>
          {server.status?.error && (
            <p className="text-xs text-destructive">{server.status.error}</p>
          )}
        </div>
        <Switch
          aria-label={t('enabled')}
          checked={server.enabled}
          disabled={update.isPending}
          onCheckedChange={(enabled) =>
            update.mutate({ id: server.id, input: { enabled } }, { onError })
          }
        />
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() => check.mutate(server.id, { onError })}
        >
          {check.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {t('check')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('remove')}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(t('removeConfirm', { name: server.name })))
              remove.mutate(server.id, { onError });
          }}
        >
          <Trash2 />
        </Button>
      </div>
      {server.models.length > 0 && (
        <ul className="divide-y text-sm">
          {server.models.map((model) => (
            <li key={model.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate" dir="ltr">
                {model.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {[model.unit ? tUnits(model.unit) : null, model.capabilities.join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
                {model.sizeBytes ? ` · ${gib(model.sizeBytes)}` : ''}
              </span>
              {model.loaded ? (
                <Badge variant="secondary" className="text-xs">
                  {t('loaded')}
                </Badge>
              ) : model.downloaded === false ? (
                <Badge variant="outline" className="text-xs">
                  {t('notDownloaded')}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function ServerDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: LocalAiSettings;
}) {
  const t = useTranslations('localAi.servers');
  const tRoot = useTranslations('localAi');
  const locale = useLocale();
  const create = useCreateModelServer();
  const lemonade = settings.serverTypes.find((type) => type.id === 'lemonade');
  const [form, setForm] = useState<ServerInput>({
    slug: settings.servers.length === 0 ? 'local' : '',
    kind: 'lemonade',
    name: '',
    baseUrl: lemonade?.defaultBaseUrl ?? 'http://127.0.0.1:13305/api/v1',
    keySource: 'file',
    keyFile: '/etc/helena/local-ai.key',
    key: '',
  });
  const set = (patch: Partial<ServerInput>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('add')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('kind')}</span>
            <Select
              value={form.kind}
              onValueChange={(kind) =>
                set({
                  kind,
                  baseUrl:
                    settings.serverTypes.find((type) => type.id === kind)?.defaultBaseUrl ??
                    form.baseUrl,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {settings.serverTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {resolveLabel(type.label, locale, (key) => tRoot(key as never))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('slug')}</span>
            <Input value={form.slug ?? ''} onChange={(e) => set({ slug: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('name')}</span>
            <Input value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('baseUrl')}</span>
            <Input
              dir="ltr"
              value={form.baseUrl ?? ''}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('keySource')}</span>
            <Select
              value={form.keySource}
              onValueChange={(keySource) =>
                set({ keySource: keySource as ServerInput['keySource'] })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['file', 'stored', 'none'] as const).map((source) => (
                  <SelectItem key={source} value={source}>
                    {t(`keys.${source}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {form.keySource === 'file' && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">{t('keyFile')}</span>
              <Input
                dir="ltr"
                value={form.keyFile ?? ''}
                onChange={(e) => set({ keyFile: e.target.value })}
              />
            </label>
          )}
          {form.keySource === 'stored' && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">{t('key')}</span>
              <Input
                type="password"
                autoComplete="off"
                value={form.key ?? ''}
                onChange={(e) => set({ key: e.target.value })}
              />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { ...form, name: form.name || undefined },
                {
                  onSuccess: () => onOpenChange(false),
                  onError: (error: Error) => toast.error(error.message),
                },
              )
            }
          >
            {create.isPending && <LoaderCircle className="animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PresetSection({ settings }: { settings: LocalAiSettings }) {
  const t = useTranslations('localAi.presets');
  const update = useUpdateLocalAiPolicy();
  return (
    <SettingsSection title={t('title')} description={t('description')}>
      <SettingsCard className="p-4">
        <Select
          value={settings.policy.preset}
          onValueChange={(preset) =>
            update.mutate(
              { preset: preset as LocalAiPreset },
              { onError: (error: Error) => toast.error(error.message) },
            )
          }
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {t(preset)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-2 text-xs text-muted-foreground">{t(`${settings.policy.preset}Hint`)}</p>
      </SettingsCard>
    </SettingsSection>
  );
}

function latestEval(settings: LocalAiSettings, entry: LocalAiClass): LocalAiEval | null {
  const model = entry.resolvedModel;
  return settings.evals.find((item) => item.classId === entry.id && item.modelId === model) ?? null;
}

function ClassRow({ entry, settings }: { entry: LocalAiClass; settings: LocalAiSettings }) {
  const t = useTranslations('localAi');
  const locale = useLocale();
  const format = useFormatter();
  const update = useUpdateLocalAiPolicy();
  const run = useRunLocalAiEval();
  const onError = (error: Error) => toast.error(error.message);
  const models = settings.servers
    .filter((server) => server.enabled)
    .flatMap((server) =>
      server.models.filter(
        (model) => model.capabilities.includes(entry.capability) && model.downloaded !== false,
      ),
    );
  const result = latestEval(settings, entry);
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {resolveLabel(entry.label, locale, (key) => t(key as never))}
          <span className="text-xs font-normal text-muted-foreground uppercase">
            {t(`units.${entry.unit}`)}
          </span>
          {entry.experimental && (
            <Badge variant="outline" className="text-xs">
              {t('jev.experimental')}
            </Badge>
          )}
          {!entry.wired && (
            <Badge variant="outline" className="text-xs">
              {t('planned')}
            </Badge>
          )}
        </div>
        {entry.description && (
          <p className="text-xs text-muted-foreground">
            {resolveLabel(entry.description, locale, (key) => t(key as never))}
          </p>
        )}
        {result ? (
          <p className="text-xs">
            <StatusBadge status={result.passed ? 'success' : 'danger'} className="text-xs">
              {t('eval.result', {
                score: Math.round(result.score * 100),
                threshold: Math.round(result.threshold * 100),
              })}
            </StatusBadge>{' '}
            <span className="text-muted-foreground">
              {[
                result.latencyMsP50 != null && t('eval.latency', { ms: result.latencyMsP50 }),
                result.tokensPerSecond != null &&
                  t('eval.speed', {
                    tps: format.number(result.tokensPerSecond, { maximumFractionDigits: 0 }),
                  }),
                shortModel(result.modelId),
                formatDateTime(result.ranAt),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {result.error && <span className="block text-destructive">{result.error}</span>}
          </p>
        ) : (
          entry.hasEval && <p className="text-xs text-muted-foreground">{t('eval.none')}</p>
        )}
        {entry.blocker && entry.mode === 'off' && (
          <p className="text-xs text-muted-foreground">{t(`blockers.${entry.blocker}`)}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={entry.model ?? AUTO}
          onValueChange={(value) =>
            update.mutate(
              { classes: { [entry.id]: { model: value === AUTO ? null : value } } },
              { onError },
            )
          }
        >
          <SelectTrigger className="w-56" aria-label={t('model')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>
              {t('autoModel', { model: shortModel(entry.resolvedModel) || '–' })}
            </SelectItem>
            {models.map((model) => (
              <SelectItem key={model.modelId} value={model.modelId}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={entry.mode}
          onValueChange={(mode) =>
            update.mutate({ classes: { [entry.id]: { mode: mode as LocalAiMode } } }, { onError })
          }
        >
          <SelectTrigger className="w-44" aria-label={t('mode')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem
                key={mode}
                value={mode}
                disabled={mode !== 'off' && entry.mode === 'off' && entry.blocker !== null}
              >
                {t(`modes.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {entry.hasEval && (
          <Button
            variant="outline"
            size="sm"
            disabled={!entry.resolvedModel || run.isPending}
            onClick={() =>
              entry.resolvedModel &&
              run.mutate(
                { classId: entry.id, modelId: entry.resolvedModel },
                {
                  onSuccess: (value) =>
                    toast[value.passed ? 'success' : 'error'](
                      t('eval.done', { score: Math.round(value.score * 100) }),
                    ),
                  onError,
                },
              )
            }
          >
            {run.isPending ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
            {t('eval.run')}
          </Button>
        )}
      </div>
    </div>
  );
}

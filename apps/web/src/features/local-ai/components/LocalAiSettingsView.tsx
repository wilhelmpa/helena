'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  ConfigurableCapability,
  LocalAiClass,
  LocalAiEval,
  LocalAiMode,
  LocalAiPreset,
  LocalAiSettings,
  ModelServer,
  ServerLoad,
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
import { groupClasses, resolveLabel, shortModel } from '../utils/localAi';
import {
  CAPABILITIES,
  loadFacts,
  newServerForm,
  serverInput,
  type ServerForm,
  HALOGEN,
  addableServerTypes,
  shownServers,
} from '../utils/serverForm';
import LocalAiCard from './LocalAiCard';
import LocalAiJudgeSection from './LocalAiJudgeSection';
import LocalModelRow from './LocalModelRow';
import LocalProfileSwitch from './LocalProfileSwitch';
import VoiceSettingsSection from '@/features/voice/components/VoiceSettingsSection';

const MODES: LocalAiMode[] = ['off', 'prefer', 'only'];
const PRESETS: LocalAiPreset[] = ['sparsam', 'ausgewogen', 'qualitaet', 'eigene'];
const AUTO = '__auto__';

// Lokale KI in full (Administrator; hub/server-admin mounts it in Administrator → Server): the
// card, the model servers and their models, each kind of work with its mode, model and eval,
// and the presets. The owner decides; a class leaves "Aus" only once its eval passed.
export default function LocalAiSettingsView() {
  const settings = useLocalAiSettings();
  const data = settings.data;
  useFinishedEvalToasts(data);

  return (
    <div className="flex flex-col gap-6">
      {/* As wide as the settings groups below it. */}
      <div className="ds-settings-section">
        <LocalAiCard showClasses={false} />
      </div>
      {!data ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : (
        <>
          <LocalProfileSwitch />
          <ServersSection settings={data} />
          <ClassesSection settings={data} />
          <LocalAiJudgeSection />
          {/* The escalation rules live in Agenten und Modelle (owner 28.09.). */}
          <VoiceSettingsSection />
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
      {shownServers(settings.servers).length === 0 ? (
        <SettingsCard className="p-4 text-sm text-muted-foreground">{t('none')}</SettingsCard>
      ) : (
        shownServers(settings.servers).map((server) => (
          <ServerCard key={server.id} server={server} settings={settings} />
        ))
      )}
      {adding && <ServerDialog open onOpenChange={setAdding} settings={settings} />}
    </SettingsSection>
  );
}

function ServerCard({ server, settings }: { server: ModelServer; settings: LocalAiSettings }) {
  const t = useTranslations('localAi.servers');
  const [editing, setEditing] = useState(false);
  const check = useCheckModelServer();
  const update = useUpdateModelServer();
  const remove = useDeleteModelServer();
  const onError = (error: Error) => toast.error(error.message);
  const reachable = server.status?.reachable ?? false;
  return (
    <SettingsCard className="divide-y">
      {/* On a phone the controls go under the server's lines instead of squeezing them. */}
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 font-medium">
            {server.name}
            <StatusBadge
              status={!server.enabled ? 'idle' : reachable ? 'success' : 'danger'}
              className="text-xs"
            >
              {!server.enabled
                ? t('disabled')
                : !reachable
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
          {server.status?.reachable && server.status.load && (
            <ServerLoadLine load={server.status.load} />
          )}
          {server.enabled && server.status?.error && (
            <p className="text-xs text-destructive">{server.status.error}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
            aria-label={t('edit')}
            onClick={() => setEditing(true)}
          >
            <Pencil />
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
      </div>
      {/* A switched-off server's models are in no picker: not listed either. */}
      {server.enabled && server.models.length > 0 && (
        <ul className="divide-y text-sm">
          {server.models.map((model) => (
            <LocalModelRow key={model.id} server={server} model={model} />
          ))}
        </ul>
      )}
      {editing && (
        <ServerDialog open onOpenChange={setEditing} settings={settings} server={server} />
      )}
    </SettingsCard>
  );
}

// How busy a server is, where it counts its own work (Halogen): speed, slots, memory, cache.
function ServerLoadLine({ load }: { load: ServerLoad }) {
  const t = useTranslations('localAi.servers.load');
  const format = useFormatter();
  const facts = loadFacts(load);
  if (facts.length === 0) return null;
  const number = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  return (
    <p className="text-xs text-muted-foreground">
      {facts
        .map((fact) => {
          switch (fact.kind) {
            case 'speed':
              return t('speed', { output: number(fact.output), prompt: number(fact.prompt ?? 0) });
            case 'slots':
              return t('slots', { busy: fact.busy, slots: fact.slots, queued: fact.queued });
            case 'memory':
              return t('memory', { gb: number(fact.gb) });
            case 'kv':
              return t('kv', { percent: number(fact.percent) });
            case 'gpu':
              return t('gpu', { percent: number(fact.percent) });
          }
        })
        .join(' · ')}
    </p>
  );
}

function ServerDialog({
  open,
  onOpenChange,
  settings,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: LocalAiSettings;
  // Set: the dialog changes this server (its short name and kind stay).
  server?: ModelServer;
}) {
  const t = useTranslations('localAi.servers');
  const tRoot = useTranslations('localAi');
  const locale = useLocale();
  const create = useCreateModelServer();
  const update = useUpdateModelServer();
  const pending = create.isPending || update.isPending;
  const initial = (): ServerForm =>
    server
      ? {
          slug: server.slug,
          kind: server.kind,
          name: server.name,
          baseUrl: server.baseUrl,
          keySource: server.keySource,
          keyFile: server.keyFile ?? '/etc/helena/local-ai.key',
          key: '',
          contextLength: String(server.contextLength),
          capabilities: server.options.capabilities,
        }
      : newServerForm(settings, HALOGEN);
  // Mounted only while open (see its callers), so each opening starts from the server as it is.
  const [form, setForm] = useState<ServerForm>(initial);
  const set = (patch: Partial<ServerForm>) => setForm((current) => ({ ...current, ...patch }));
  const type = settings.serverTypes.find((entry) => entry.id === form.kind);
  const save = () => {
    const input = serverInput(form, type?.capabilitiesConfigurable === true, server !== undefined);
    const done = {
      onSuccess: () => onOpenChange(false),
      onError: (error: Error) => toast.error(error.message),
    };
    if (server) update.mutate({ id: server.id, input }, done);
    else create.mutate(input, done);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{server ? t('editTitle', { name: server.name }) : t('add')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('kind')}</span>
            <Select
              value={form.kind}
              disabled={server !== undefined}
              onValueChange={(kind) =>
                setForm((current) => ({
                  ...newServerForm(settings, kind),
                  slug: current.slug,
                  name: current.name,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {addableServerTypes(settings.serverTypes, form.kind).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {resolveLabel(entry.label, locale, (key) => tRoot(key as never))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('slug')}</span>
            <Input
              value={form.slug}
              disabled={server !== undefined}
              onChange={(e) => set({ slug: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('name')}</span>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('baseUrl')}</span>
            <Input
              dir="ltr"
              value={form.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('contextLength')}</span>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={form.contextLength}
              onChange={(e) => set({ contextLength: e.target.value.replace(/[^0-9]/g, '') })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('keySource')}</span>
            <Select
              value={form.keySource}
              onValueChange={(keySource) =>
                set({ keySource: keySource as ServerForm['keySource'] })
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
                value={form.keyFile}
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
                placeholder={server?.keySource === 'stored' ? t('keyKept') : undefined}
                value={form.key}
                onChange={(e) => set({ key: e.target.value })}
              />
            </label>
          )}
          {type?.capabilitiesConfigurable && (
            <CapabilitiesField
              value={form.capabilities}
              onChange={(capabilities) => set({ capabilities })}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending && <LoaderCircle className="animate-spin" />}
            {server ? t('saveChanges') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// What a server's chat models can do: what Helena reads from the server (the default), or
// what the Administrator sets, for a server whose API does not say.
function CapabilitiesField({
  value,
  onChange,
}: {
  value: ConfigurableCapability[] | null;
  onChange: (value: ConfigurableCapability[] | null) => void;
}) {
  const t = useTranslations('localAi.servers.capabilities');
  const own = value !== null;
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t('title')}</span>
        <span className="flex items-center gap-2 text-xs">
          {own ? t('own') : t('derived')}
          <Switch
            aria-label={t('own')}
            checked={own}
            onCheckedChange={(on) => onChange(on ? ['tools'] : null)}
          />
        </span>
      </label>
      {own && (
        <div className="flex flex-wrap gap-4">
          {CAPABILITIES.map((capability) => (
            <label key={capability} className="flex items-center gap-2">
              <Checkbox
                checked={value.includes(capability)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? CAPABILITIES.filter(
                          (entry) => entry === capability || value.includes(entry),
                        )
                      : value.filter((entry) => entry !== capability),
                  )
                }
              />
              {t(capability)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// The kinds of work: those that run locally now and those ready to switch on, each with its
// model, mode and eval; the rest (waiting for an eval, not wired yet, experimental) folded
// away. The preset switches them at once.
function ClassesSection({ settings }: { settings: LocalAiSettings }) {
  const t = useTranslations('localAi');
  const update = useUpdateLocalAiPolicy();
  const [open, setOpen] = useState(false);
  const groups = groupClasses(settings.classes);
  const rows = (entries: LocalAiClass[]) =>
    entries.map((entry) => <ClassRow key={entry.id} entry={entry} settings={settings} />);
  return (
    <SettingsSection
      title={t('classesTitle')}
      description={t('classesDescription')}
      action={
        <Select
          value={settings.policy.preset}
          onValueChange={(preset) =>
            update.mutate(
              { preset: preset as LocalAiPreset },
              { onError: (error: Error) => toast.error(error.message) },
            )
          }
        >
          <SelectTrigger className="w-40" aria-label={t('presets.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {t(`presets.${preset}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <SettingsCard className="divide-y">
        {groups.active.length + groups.ready.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t('classGroups.none')}</p>
        ) : (
          <>
            {groups.active.length > 0 && (
              <GroupHead label={t('classGroups.active')} count={groups.active.length} />
            )}
            {rows(groups.active)}
            {groups.ready.length > 0 && (
              <GroupHead label={t('classGroups.ready')} count={groups.ready.length} />
            )}
            {rows(groups.ready)}
          </>
        )}
        {groups.more.length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-start text-xs text-muted-foreground hover:bg-accent"
              >
                {open ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {t('classGroups.more', { count: groups.more.length })}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="divide-y border-t">
              {rows(groups.more)}
            </CollapsibleContent>
          </Collapsible>
        )}
      </SettingsCard>
      <p className="text-xs text-muted-foreground">{t(`presets.${settings.policy.preset}Hint`)}</p>
    </SettingsSection>
  );
}

function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-1">
      <span className="ds-mono-label">{`${label} · ${count}`}</span>
    </div>
  );
}

// Says when an eval the page saw running has finished, with its score. An eval runs in the
// background; the page may have been opened while it ran.
function useFinishedEvalToasts(data: LocalAiSettings | undefined) {
  const t = useTranslations('localAi');
  const running = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!data) return;
    const now = new Set(data.runningEvals.map((item) => item.id));
    for (const id of running.current ?? []) {
      if (now.has(id)) continue;
      const done = data.evals.find((item) => item.id === id);
      if (done)
        toast[done.passed ? 'success' : 'error'](
          t('eval.done', { score: Math.round(done.score * 100) }),
        );
    }
    running.current = now;
  }, [data, t]);
}

// The newest eval of the class's model in the class's current eval version: an older one
// measured something the class no longer does, and the class needs a new one.
function latestEval(settings: LocalAiSettings, entry: LocalAiClass): LocalAiEval | null {
  const model = entry.resolvedModel;
  return (
    settings.evals.find(
      (item) =>
        item.classId === entry.id &&
        item.modelId === model &&
        item.evalVersion >= entry.evalVersion,
    ) ?? null
  );
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
  const running = settings.runningEvals.find(
    (item) => item.classId === entry.id && item.modelId === entry.resolvedModel,
  );
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {resolveLabel(entry.label, locale, (key) => t(key as never))}
          <span className="text-xs font-normal text-muted-foreground uppercase">
            {t(`units.${entry.unit}`)}
          </span>
          {(entry.capability === 'chat' || entry.capability === 'tools') && (
            <span className="text-xs font-normal text-muted-foreground">
              {t(`thinking.${entry.thinking}`)}
            </span>
          )}
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
        {running && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {t('eval.running', { model: shortModel(running.modelId) })}
          </p>
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
            {MODES.filter((mode) => entry.modes.includes(mode)).map((mode) => (
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
            disabled={!entry.resolvedModel || run.isPending || running !== undefined}
            onClick={() =>
              entry.resolvedModel &&
              run.mutate(
                { classId: entry.id, modelId: entry.resolvedModel },
                { onSuccess: () => toast(t('eval.started')), onError },
              )
            }
          >
            {run.isPending || running ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <FlaskConical />
            )}
            {t('eval.run')}
          </Button>
        )}
      </div>
    </div>
  );
}

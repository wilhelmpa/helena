import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink, Loader2, PlugZap } from 'lucide-react';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import type { DecisionBackend, LocalizedLabel } from '@/lib/api/endpoints/browserTask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useDecisionBackendsQuery,
  useTestDecisionConnection,
} from '@/features/browser-lab/services/browserTask.service';
import { useDecisionKeySourcesQuery } from '@/services/credentials.service';
import type { CredentialFormValue } from '../../utils/credentialForm';
import { CredentialSecretInput } from './CredentialSecretInput';

export function localized(label: LocalizedLabel, locale: string): string {
  if (typeof label === 'string') return label;
  return label[locale] ?? label[locale.split('-')[0]!] ?? label.en ?? Object.values(label)[0] ?? '';
}

// The choice as the select shows it: a kind of service, or one of its presets ("Laya (lokal
// auf diesem Server)").
function choiceOf(value: CredentialFormValue): string {
  return value.keySource === 'stored' || value.keySource === 'credential'
    ? value.provider
    : `${value.provider}:${value.keySource}`;
}

// A decision model connection ("Entscheidungsmodell (Jev)", docs/helena-decisions/browser-task.md
// §3.3): which System One service, its address and model, the key, and for a server of the
// owner's own whether its local address may be reached. A saved one can be tested here.
export function CredentialDecisionModelFields({
  teamId,
  value,
  entry,
  onChange,
}: {
  teamId: number;
  value: CredentialFormValue;
  entry: CredentialEntry | null;
  onChange: (patch: Partial<CredentialFormValue>) => void;
}) {
  const t = useTranslations('browserLab.connection');
  const locale = useLocale();
  const backends = useDecisionBackendsQuery().data?.backends ?? [];
  const test = useTestDecisionConnection(teamId);
  const backend: DecisionBackend | undefined = backends.find((b) => b.id === value.provider);
  const local = value.keySource === 'local-ai' || value.keySource === 'local-laya';
  const sources = useDecisionKeySourcesQuery(
    teamId,
    value.projectId,
    value.keySource === 'credential',
  );

  const choose = (choice: string) => {
    const [id, preset] = choice.split(':');
    const next = backends.find((b) => b.id === id);
    if (!next) return;
    const chosen = preset ? next.presets.find((p) => p.id === preset) : undefined;
    onChange({
      provider: next.id,
      baseUrl: chosen?.baseUrl ?? next.defaultBaseUrl ?? '',
      model: chosen?.model ?? next.defaultModel,
      allowPrivateAddress: chosen?.allowPrivateAddress ?? false,
      keySource: chosen?.keySource ?? 'stored',
      sourceCredentialId: null,
      value: '',
      ...(!value.label.trim() && {
        label: chosen ? localized(chosen.label, locale) : localized(next.label, locale),
      }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t('service')}</Label>
        <Select value={choiceOf(value)} onValueChange={choose}>
          <SelectTrigger className="w-full" aria-label={t('service')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {backends.flatMap((b) => [
              <SelectItem key={b.id} value={b.id}>
                {localized(b.label, locale)}
              </SelectItem>,
              ...b.presets.map((p) => (
                <SelectItem key={`${b.id}:${p.id}`} value={`${b.id}:${p.id}`}>
                  {localized(p.label, locale)}
                </SelectItem>
              )),
            ])}
          </SelectContent>
        </Select>
        {backend?.location === 'cloud' && (
          <p className="text-xs text-muted-foreground">{t('cloudNote')}</p>
        )}
        {backend?.location === 'local' && (
          <p className="text-xs text-muted-foreground">
            {backend.protocol && backend.protocol !== 'systemone'
              ? t('localModelNote')
              : t('localNote')}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="decision-base-url">{t('address')}</Label>
          <Input
            id="decision-base-url"
            dir="ltr"
            value={value.baseUrl}
            placeholder={backend?.defaultBaseUrl ?? 'http://192.168.2.10:8791'}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="decision-model">{t('model')}</Label>
          <Input
            id="decision-model"
            dir="ltr"
            value={value.model}
            placeholder={backend?.defaultModel ?? ''}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </div>
      </div>

      {backend?.location === 'local' && !local && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-sidebar-border bg-card px-3 py-2">
          <div className="space-y-0.5">
            <Label htmlFor="decision-private">{t('allowPrivate')}</Label>
            <p className="text-xs text-muted-foreground">{t('allowPrivateHint')}</p>
          </div>
          <Switch
            id="decision-private"
            checked={value.allowPrivateAddress}
            onCheckedChange={(allowPrivateAddress) => onChange({ allowPrivateAddress })}
          />
        </div>
      )}

      {!local && (
        <div className="space-y-1.5">
          <Label>{t('keySource')}</Label>
          <Select
            value={value.keySource}
            onValueChange={(keySource: 'stored' | 'credential') =>
              onChange({ keySource, value: '' })
            }
          >
            <SelectTrigger className="w-full" aria-label={t('keySource')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stored">{t('keySourceStored')}</SelectItem>
              <SelectItem value="credential">{t('keySourceCredential')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {value.keySource === 'credential' ? (
        <div className="space-y-1.5">
          <Label>{t('keyCredential')}</Label>
          <Select
            value={value.sourceCredentialId?.toString() ?? ''}
            onValueChange={(id) => onChange({ sourceCredentialId: Number(id) })}
          >
            <SelectTrigger className="w-full" aria-label={t('keyCredential')}>
              <SelectValue placeholder={t('chooseKeyCredential')} />
            </SelectTrigger>
            <SelectContent>
              {(sources.data?.items ?? []).map((source) => (
                <SelectItem key={source.id} value={String(source.id)}>
                  {source.label ?? `#${source.id}`}
                  {source.projectKey ? ` · ${source.projectKey}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('keyCredentialHint')}</p>
          {sources.isPending && (
            <p className="text-xs text-muted-foreground">{t('keySourcesLoading')}</p>
          )}
          {(sources.isError ||
            (sources.isSuccess &&
              (!sources.data.items.length ||
                (value.sourceCredentialId !== null &&
                  !sources.data.items.some(
                    (source) => source.id === value.sourceCredentialId,
                  ))))) && (
            <p role="alert" className="text-xs text-destructive">
              {t('keySourceUnavailable')}
            </p>
          )}
        </div>
      ) : local ? (
        <p className="rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {value.keySource === 'local-ai' ? t('localAiKey') : t('localKey')}
        </p>
      ) : (
        <CredentialSecretInput
          label={t('key')}
          optional={!backend?.keyRequired}
          hint={
            value.provider === 'vercel'
              ? t('keyHintVercel')
              : value.provider === 'typesafe'
                ? t('keyHintTypesafe')
                : t('keyHintCompatible')
          }
          value={value.value}
          stored={entry?.secrets.includes('value') ?? false}
          onChange={(next) => onChange({ value: next })}
        />
      )}
      {backend?.signupUrl && !local && (
        <a
          href={backend.signupUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3" />
          {t('signup', { host: new URL(backend.signupUrl).host })}
        </a>
      )}

      {entry && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={() => test.mutate(entry.id)}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
            {t('test')}
          </Button>
          {entry.status && (
            <span className="text-xs text-muted-foreground">
              {entry.status === 'ok' ? t('lastOk') : t('lastError')}
              {entry.statusDetail ? ` · ${entry.statusDetail}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

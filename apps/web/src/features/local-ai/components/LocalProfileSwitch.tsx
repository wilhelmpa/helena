'use client';

import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Button,
  Dialog,
  Inline,
  Notice,
  Segmented,
  SettingsGroup,
  SettingsRow,
  Stack,
  Text,
} from '@/design-system';
import type { LocalProfileId, NpuChatModel } from '@/lib/api/endpoints/globalModel';
import {
  useGlobalLocalModel,
  useGlobalModelActions,
  useSwitchPreview,
} from '../services/globalModel.service';
import { useLocalAiSettings } from '../services/localAi.service';
import {
  DEFAULT_NPU_MODEL,
  LOCAL_PROFILE_IDS,
  currentProfile,
  isNpuChatModel,
  npuModelKey,
  npuModelName,
  pendingOperation,
  switchRequest,
} from '../utils/localProfile';
import { switchErrorKey } from '../utils/switchErrors';

const NONE = '__none__';

// The local profile in Administrator → Lokale KI: "Lokal Halogen" (Flash on the GPU, NPU off) or
// "Lokal 27B + NPU" (Qwen3.8-27B on the GPU, a small model on the NPU for the small work). The
// NPU models on offer are the ones the server names for the paired profile; nothing is changed
// until the owner has seen what the switch reaches and confirms. A switch that stopped half
// way is continued or taken back here.
export default function LocalProfileSwitch() {
  const t = useTranslations('localAi.profileSwitch');
  const settings = useLocalAiSettings();
  const status = useGlobalLocalModel();
  const actions = useGlobalModelActions();
  const servers = settings.data?.servers ?? [];
  const current = currentProfile(status.data);
  const pending = pendingOperation(status.data);

  const [pickedProfile, setPickedProfile] = useState<LocalProfileId | null>(null);
  const [pickedNpu, setPickedNpu] = useState<NpuChatModel | null>(null);
  const [confirming, setConfirming] = useState(false);
  const profile = pickedProfile ?? current.profile ?? 'local-halogen';
  const paired = profile === 'local-27b-npu';
  const npu = pickedNpu ?? current.npu ?? DEFAULT_NPU_MODEL;

  // The NPU models the paired profile offers come from the server's own answer for it.
  const offer = useSwitchPreview(
    settings.data ? switchRequest('local-27b-npu', null, servers) : null,
  );
  const npuOptions = (offer.data?.npuSelection ?? []).filter(isNpuChatModel);
  const request = settings.data ? switchRequest(profile, paired ? npu : null, servers) : null;
  const preview = useSwitchPreview(request);

  const unchanged = profile === current.profile && (!paired || npu === current.npu);
  const busy = actions.apply.isPending || actions.resume.isPending;
  const onError = (error: Error) => toast.error(error.message);

  const apply = async () => {
    if (!request) return;
    try {
      await actions.apply.mutateAsync(request);
      toast.success(t('started'));
      setConfirming(false);
      setPickedProfile(null);
      setPickedNpu(null);
    } catch (error) {
      onError(error as Error);
    }
  };

  const impact = preview.data
    ? t('impact', {
        agents: preview.data.agents.length,
        classes: preview.data.classes.length,
      })
    : preview.isError
      ? undefined
      : null;

  return (
    <SettingsGroup title={t('title')} description={t('description')}>
      {pending && (
        <Notice
          tone="warning"
          title={t('pending.title')}
          action={
            <Inline gap={2}>
              <Button
                size="small"
                variant="primary"
                disabled={busy}
                onClick={() => actions.resume.mutate(false, { onError })}
              >
                {t('pending.resume')}
              </Button>
              <Button
                size="small"
                disabled={busy}
                onClick={() => actions.resume.mutate(true, { onError })}
              >
                {t('pending.rollback')}
              </Button>
            </Inline>
          }
        >
          {pending.error ? t('pending.failed') : t('pending.running')}
        </Notice>
      )}
      <SettingsRow label={t('profile')} description={t(`profiles.${profile}` as never)}>
        <Segmented
          label={t('profile')}
          value={profile}
          options={LOCAL_PROFILE_IDS.map((id) => ({ value: id, label: t(`names.${id}` as never) }))}
          onChange={(value) => setPickedProfile(value)}
        />
      </SettingsRow>
      <SettingsRow
        label={t('npu.label')}
        description={
          !paired
            ? t('npu.off')
            : offer.isError
              ? t(switchErrorKey(offer.error.message))
              : t('npu.hint')
        }
      >
        <Select
          value={paired ? npu : NONE}
          onValueChange={(value) => isNpuChatModel(value) && setPickedNpu(value)}
          disabled={!paired || npuOptions.length === 0}
        >
          <SelectTrigger aria-label={t('npu.label')} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!paired && <SelectItem value={NONE}>{t('npu.none')}</SelectItem>}
            {paired && npuOptions.length === 0 && (
              <SelectItem value={npu} disabled>
                {npuModelName(npu)}
              </SelectItem>
            )}
            {npuOptions.map((model) => (
              <SelectItem key={model} value={model}>
                {npuModelName(model)} · {t(`npu.models.${npuModelKey(model)}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label={t('switch.label')}
        description={
          unchanged
            ? t('switch.unchanged')
            : preview.isError
              ? t(switchErrorKey(preview.error.message))
              : impact === null
                ? t('switch.checking')
                : impact
        }
      >
        <Button
          variant="primary"
          size="small"
          disabled={unchanged || !preview.data || !!pending || busy}
          icon={busy ? <LoaderCircle className="animate-spin" size={14} /> : undefined}
          onClick={() => setConfirming(true)}
        >
          {t('switch.button')}
        </Button>
      </SettingsRow>
      {confirming && preview.data && (
        <Dialog
          title={t('confirm.title', { profile: t(`names.${profile}` as never) })}
          onClose={() => !busy && setConfirming(false)}
        >
          <Stack gap={4}>
            <Text tone="muted">{t('confirm.text')}</Text>
            <Text weight="medium">
              {t('impact', {
                agents: preview.data.agents.length,
                classes: preview.data.classes.length,
              })}
            </Text>
            {preview.data.agents.length > 0 && (
              <Text tone="muted">
                {preview.data.agents
                  .slice(0, 12)
                  .map((agent) => agent.name)
                  .join(', ')}
                {preview.data.agents.length > 12 &&
                  ` ${t('confirm.more', { count: preview.data.agents.length - 12 })}`}
              </Text>
            )}
            {paired && <Text tone="muted">{t('confirm.npu', { model: npuModelName(npu) })}</Text>}
            <Inline gap={2} justify="end">
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                {t('confirm.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                icon={busy ? <LoaderCircle className="animate-spin" size={14} /> : undefined}
                onClick={() => void apply()}
              >
                {t('confirm.apply')}
              </Button>
            </Inline>
          </Stack>
        </Dialog>
      )}
    </SettingsGroup>
  );
}

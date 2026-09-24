import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import {
  AGENT_VIEWPORT_LIMITS,
  MAX_BROWSER_GATEWAY_DOMAINS,
  MAX_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC,
  MIN_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC,
} from '@/lib/api/endpoints/browserGateway';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useBrowserGatewaySettingsQuery,
  useUpdateBrowserGatewaySettings,
} from '../../services/settings.service';
import DomainListField from './DomainListField';

// The browser gateway settings tab (design volition-design-browser-gateway.md §8, "Projekt
// → Einstellungen → Browser"): the domain blocklist and optional allowlist a project's
// agents may navigate to, whether typing and clicking use human-like timing, and the
// control lock's timeout. Every control writes immediately, like SettingsGit — there is
// no form-level save.
export default function SettingsBrowserGateway({ project }: { project: ProjectDetail }) {
  const t = useTranslations('settings.browser');
  const projectKey = project.project.key;
  const { can } = usePermissions();
  const settingsQuery = useBrowserGatewaySettingsQuery(projectKey);
  const updateSettings = useUpdateBrowserGatewaySettings(projectKey);
  const editable = can('ai_agents', 'edit');

  // The lock timeout is typed digit by digit, so it is only committed on blur/Enter,
  // unlike the lists and the switch, which write on every change.
  const [timeoutDraft, setTimeoutDraft] = useState('');
  const [viewportDraft, setViewportDraft] = useState({ width: '', height: '' });
  useEffect(() => {
    if (!settingsQuery.data) return;
    setTimeoutDraft(String(settingsQuery.data.lockTimeoutSec));
    setViewportDraft({
      width: String(settingsQuery.data.agentViewport.width),
      height: String(settingsQuery.data.agentViewport.height),
    });
  }, [settingsQuery.data]);

  if (settingsQuery.isPending || !settingsQuery.data)
    return <ListSkeleton rows={3} rowClassName="h-16" />;

  const settings = settingsQuery.data;

  const commitTimeout = () => {
    const next = Number.parseInt(timeoutDraft, 10);
    const valid =
      Number.isFinite(next) &&
      next >= MIN_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC &&
      next <= MAX_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC;
    if (valid && next !== settings.lockTimeoutSec) updateSettings.mutate({ lockTimeoutSec: next });
    else setTimeoutDraft(String(settings.lockTimeoutSec));
  };

  // Width and height are committed together once one of them is left, and only when both
  // are within the limits; otherwise the stored size comes back.
  const commitViewport = () => {
    const width = Number.parseInt(viewportDraft.width, 10);
    const height = Number.parseInt(viewportDraft.height, 10);
    const valid =
      width >= AGENT_VIEWPORT_LIMITS.minWidth &&
      width <= AGENT_VIEWPORT_LIMITS.maxWidth &&
      height >= AGENT_VIEWPORT_LIMITS.minHeight &&
      height <= AGENT_VIEWPORT_LIMITS.maxHeight;
    const current = settings.agentViewport;
    if (valid && (width !== current.width || height !== current.height)) {
      updateSettings.mutate({ agentViewport: { width, height } });
    } else if (!valid) {
      setViewportDraft({ width: String(current.width), height: String(current.height) });
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection title={t('accessTitle')} description={t('accessHint')}>
        <SettingsCard className="space-y-5 p-4">
          <DomainListField
            id="browser-gateway-blocklist"
            label={t('blocklistLabel')}
            domains={settings.domainBlocklist}
            onChange={(domainBlocklist) => updateSettings.mutate({ domainBlocklist })}
            disabled={!editable}
            max={MAX_BROWSER_GATEWAY_DOMAINS}
            hint={t('blocklistHint')}
          />
          <DomainListField
            id="browser-gateway-allowlist"
            label={t('allowlistLabel')}
            domains={settings.domainAllowlist}
            onChange={(domainAllowlist) => updateSettings.mutate({ domainAllowlist })}
            disabled={!editable}
            max={MAX_BROWSER_GATEWAY_DOMAINS}
            hint={t('allowlistHint')}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('behaviorTitle')}>
        <SettingsCard className="divide-y divide-border/60">
          <SettingsRow
            title={t('humanInputLabel')}
            description={t('humanInputHint')}
            control={
              <Switch
                checked={settings.humanInput}
                disabled={!editable}
                onCheckedChange={(humanInput) => updateSettings.mutate({ humanInput })}
              />
            }
          />
          <SettingsRow
            title={t('lockTimeoutLabel')}
            description={t('lockTimeoutHint')}
            control={
              <div className="flex shrink-0 items-center gap-2">
                <Input
                  type="number"
                  min={MIN_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC}
                  max={MAX_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC}
                  value={timeoutDraft}
                  disabled={!editable}
                  onChange={(e) => setTimeoutDraft(e.target.value)}
                  onBlur={commitTimeout}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className="h-8 w-24"
                />
                <span className="text-xs text-muted-foreground">{t('seconds')}</span>
              </div>
            }
          />
          <SettingsRow
            title={t('viewportLabel')}
            description={t('viewportHint')}
            control={
              <div className="flex shrink-0 items-center gap-1.5">
                {(['width', 'height'] as const).map((side, index) => (
                  <span key={side} className="flex items-center gap-1.5">
                    {index === 1 && <span className="text-xs text-muted-foreground">×</span>}
                    <Input
                      type="number"
                      aria-label={t(side === 'width' ? 'viewportWidth' : 'viewportHeight')}
                      min={
                        side === 'width'
                          ? AGENT_VIEWPORT_LIMITS.minWidth
                          : AGENT_VIEWPORT_LIMITS.minHeight
                      }
                      max={
                        side === 'width'
                          ? AGENT_VIEWPORT_LIMITS.maxWidth
                          : AGENT_VIEWPORT_LIMITS.maxHeight
                      }
                      value={viewportDraft[side]}
                      disabled={!editable}
                      onChange={(e) =>
                        setViewportDraft((draft) => ({ ...draft, [side]: e.target.value }))
                      }
                      onBlur={commitViewport}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      className="h-8 w-20"
                    />
                  </span>
                ))}
                <span className="text-xs text-muted-foreground">{t('pixels')}</span>
              </div>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

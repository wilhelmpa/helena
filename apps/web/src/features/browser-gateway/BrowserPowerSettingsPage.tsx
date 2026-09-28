'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BrowserPowerSettings } from '@/lib/api/endpoints/god';
import { useInstanceProjectOptionsQuery } from '@/features/god/services/god.service';
import { browserSlug, HOME_BROWSER_SLUG, type BrowserPower } from '@/utils/browserOverview';
import {
  useBrowserPowerSettingsQuery,
  useBrowserRouterOverviewQuery,
  useUpdateBrowserPowerSettings,
} from './services/browserGateway.service';

// The idle times offered, in minutes; 0 keeps every browser running.
export const IDLE_MINUTES = [5, 10, 15, 30, 60, 120, 240, 0] as const;

// Helena → Einstellungen → Browser: project browsers run on demand. One idle time for all, and
// the browsers kept running ("immer an") as the exception, with whether each runs right now.
export default function BrowserPowerSettingsPage() {
  const t = useTranslations('browserGateway.power');
  const tSections = useTranslations('settings.modal.sections');
  const settings = useBrowserPowerSettingsQuery();
  const projects = useInstanceProjectOptionsQuery();
  const overview = useBrowserRouterOverviewQuery();
  const update = useUpdateBrowserPowerSettings();

  async function save(patch: Partial<BrowserPowerSettings>) {
    try {
      await update.mutateAsync(patch);
      toast.success(t('saved'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  const powerOf = (slug: string): BrowserPower | null => {
    const state = overview.data?.find((entry) => entry.slug === slug);
    return state ? (state.power ?? 'running') : null;
  };
  const stateLabel = (slug: string) => {
    const power = powerOf(slug);
    if (power === null) return t('state.none');
    if (power === 'running') return t('state.running');
    if (power === 'starting') return t('state.starting');
    if (power === 'stopping') return t('state.stopping');
    if (power === 'stopped') return t('state.stopped');
    return t('state.unknown');
  };

  const current = settings.data;
  return (
    <SectionPageView title={tSections('browser.label')}>
      <div className="flex flex-1 flex-col gap-6">
        {!current || !projects.data ? (
          <ListSkeleton rows={4} rowClassName="h-12" />
        ) : (
          <>
            <SettingsSection title={t('idleTitle')}>
              <SettingsCard>
                <SettingsRow
                  title={t('idle')}
                  description={t('idleHint')}
                  control={
                    <Select
                      value={String(current.idleMinutes)}
                      disabled={update.isPending}
                      onValueChange={(value) => void save({ idleMinutes: Number(value) })}
                    >
                      <SelectTrigger aria-label={t('idle')} className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(IDLE_MINUTES as readonly number[]).includes(current.idleMinutes) ? null : (
                          <SelectItem value={String(current.idleMinutes)}>
                            {t('minutes', { count: current.idleMinutes })}
                          </SelectItem>
                        )}
                        {IDLE_MINUTES.map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes === 0 ? t('never') : t('minutes', { count: minutes })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsCard>
            </SettingsSection>
            <SettingsSection title={t('alwaysOnTitle')}>
              <SettingsCard>
                <SettingsRow
                  title={t('home')}
                  description={stateLabel(HOME_BROWSER_SLUG)}
                  control={
                    <Switch
                      aria-label={t('alwaysOnFor', { name: t('home') })}
                      checked={current.homeAlwaysOn}
                      disabled={update.isPending}
                      onCheckedChange={(checked) => void save({ homeAlwaysOn: checked })}
                    />
                  }
                />
                {projects.data.map((project) => {
                  const on = current.alwaysOnProjectIds.includes(project.id);
                  return (
                    <SettingsRow
                      key={project.id}
                      title={project.name}
                      description={stateLabel(browserSlug(project.key))}
                      control={
                        <Switch
                          aria-label={t('alwaysOnFor', { name: project.name })}
                          checked={on}
                          disabled={update.isPending}
                          onCheckedChange={(checked) =>
                            void save({
                              alwaysOnProjectIds: checked
                                ? [...current.alwaysOnProjectIds, project.id]
                                : current.alwaysOnProjectIds.filter((id) => id !== project.id),
                            })
                          }
                        />
                      }
                    />
                  );
                })}
              </SettingsCard>
            </SettingsSection>
          </>
        )}
      </div>
    </SectionPageView>
  );
}

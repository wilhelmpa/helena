import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
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
import type { ProjectDefaults } from '@/lib/api/endpoints/projects';
import { AUTOPILOT_LEVELS } from '@/lib/api/endpoints/autopilot';
import { useUpdateInstanceProjectDefaults } from '../services/god.service';

export default function GodProjectDefaultsSettings({ defaults }: { defaults: ProjectDefaults }) {
  const t = useTranslations('god.general');
  const tAutopilot = useTranslations('autopilot');
  const update = useUpdateInstanceProjectDefaults();

  async function saveDefaults(patch: Partial<ProjectDefaults>) {
    try {
      await update.mutateAsync({ ...defaults, ...patch });
      toast.success(t('saved'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <SettingsSection title={t('projectDefaults')}>
      <SettingsCard>
        <SettingsRow
          title={t('mcpEnabled')}
          description={t('mcpEnabledHint')}
          control={
            <Switch
              checked={defaults.mcpEnabled}
              disabled={update.isPending}
              onCheckedChange={(checked) => void saveDefaults({ mcpEnabled: checked })}
            />
          }
        />
        <SettingsRow
          title={t('autopilotDefault')}
          description={t('autopilotDefaultHint')}
          control={
            <Select
              value={String(defaults.autopilotLevel)}
              disabled={update.isPending}
              onValueChange={(value) => {
                const level = AUTOPILOT_LEVELS.find((entry) => String(entry) === value);
                if (level !== undefined) void saveDefaults({ autopilotLevel: level });
              }}
            >
              <SelectTrigger aria-label={t('autopilotDefault')} className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOPILOT_LEVELS.map((level) => (
                  <SelectItem key={level} value={String(level)}>
                    {level}: {tAutopilot(`level.${level}.name`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import type { GeneralForm } from '../../hooks/useGeneralForm';

import { Stack } from '@/design-system';

// The Project block of the General page. The key is shown read-only: it prefixes
// every issue and cannot change. Only an owner may edit; others see the values
// read-only.
export default function SettingsGeneral({ form }: { form: GeneralForm }) {
  const t = useTranslations('settings.general');
  const tCommon = useTranslations('common');

  return (
    <SettingsSection title={t('project')} description={t('projectHint')}>
      <SettingsCard>
        <Stack gap={4} pad={4}>
          <Stack gap={2}>
            <Label htmlFor="project-key">{t('key')}</Label>
            <Input id="project-key" value={form.key} disabled readOnly />
          </Stack>
          <Stack gap={2}>
            <Label htmlFor="project-name">{tCommon('name')}</Label>
            <Input
              id="project-name"
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              onBlur={() => {
                if (form.canSave) void form.save();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              disabled={!form.editable}
            />
          </Stack>
          <Stack gap={2}>
            <Label htmlFor="project-description">{tCommon('description')}</Label>
            <Textarea
              id="project-description"
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) => form.setDescription(e.target.value)}
              onBlur={() => {
                if (form.canSave) void form.save();
              }}
              disabled={!form.editable}
            />
          </Stack>
        </Stack>
      </SettingsCard>
    </SettingsSection>
  );
}

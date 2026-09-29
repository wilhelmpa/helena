import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, Inline, TextField } from '@/design-system';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { useUpdateInstanceDisplayName } from '../services/god.service';

export default function GodDisplayNameSetting({ displayName }: { displayName: string }) {
  const t = useTranslations('god.general');
  const common = useTranslations('common');
  const [value, setValue] = useState(displayName);
  const update = useUpdateInstanceDisplayName();
  const valid =
    value.length <= 40 &&
    /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .&_-]*$/u.test(value) &&
    value === value.trim();

  async function save() {
    if (!valid) return;
    try {
      await update.mutateAsync(value);
      toast.success(t('displayNameSaved'));
      window.location.reload();
    } catch {
      // The global mutation handler reports the API error.
    }
  }

  return (
    <SettingsSection title={t('displayName')}>
      <SettingsCard>
        <SettingsRow
          title={t('displayName')}
          description={t('displayNameHint')}
          control={
            <Inline gap={2}>
              <TextField
                value={value}
                aria-label={t('displayName')}
                maxLength={40}
                aria-invalid={!valid}
                onChange={(event) => setValue(event.target.value)}
              />
              <Button
                disabled={!valid || value === displayName || update.isPending}
                onClick={() => void save()}
              >
                {update.isPending ? common('saving') : common('save')}
              </Button>
            </Inline>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { APP_NAME, UPSTREAM_URL } from '@/utils/app';

// The AGPL-3.0 attribution the fork's licence requires, next to the product name. No
// version: the owner wants none shown anywhere (2026-09-24). Reuses the nav menu's own
// basedOn copy and link (see messages/*/nav.json) so the wording stays in one place.
export default function GodAboutSection() {
  const t = useTranslations('god.general');
  const tNav = useTranslations('nav');

  return (
    <SettingsSection title={t('about')}>
      <SettingsCard className="space-y-1 p-4">
        <div className="text-sm font-medium">{APP_NAME}</div>
        <a
          href={UPSTREAM_URL}
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {tNav('basedOn')}
        </a>
      </SettingsCard>
    </SettingsSection>
  );
}

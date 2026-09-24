import type { ReactNode } from 'react';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';

// A group of related preferences in the settings look every settings page shares: the
// group's title on the left, its rows in one sidebar-toned card on the right.
export default function AccountPreferencesSection({
  id,
  title,
  description,
  bare = false,
  children,
}: {
  // The anchor a link to one group of the page lands on.
  id: string;
  title: string;
  description?: string;
  // For content that brings its own cards (the shortcut editor).
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-4">
      <SettingsSection title={title} description={description}>
        {bare ? children : <SettingsCard className="divide-y">{children}</SettingsCard>}
      </SettingsSection>
    </div>
  );
}

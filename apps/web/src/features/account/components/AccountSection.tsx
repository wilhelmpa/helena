import type { ReactNode } from 'react';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';

// One block of an account page, in the settings look every other settings page uses:
// the title (14px) and its one-line explanation on the left, the content in one
// sidebar-toned card on the right (one column on a narrow page). `actions` sits beside
// the title (e.g. "Add passkey"). `flush` drops the card's padding for a list whose
// rows carry their own.
export default function AccountSection({
  title,
  description,
  actions,
  flush = false,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} description={description} action={actions}>
      <SettingsCard className={flush ? 'divide-y' : 'p-4'}>{children}</SettingsCard>
    </SettingsSection>
  );
}

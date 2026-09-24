import type { ReactNode } from 'react';
import ProjectSettingsShell from '@/features/settings/ProjectSettingsShell';

// Part of the project settings: listed in their second column, like the pages under
// settings/ (the main sidebar only has the one entry into them).
export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return <ProjectSettingsShell>{children}</ProjectSettingsShell>;
}

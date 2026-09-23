import type { ReactNode } from 'react';
import ProjectSettingsShell from '@/features/settings/ProjectSettingsShell';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <ProjectSettingsShell>{children}</ProjectSettingsShell>;
}

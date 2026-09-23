import { useSidebarSettingsNavItems } from '@/hooks/useSidebarSettingsNavItems';
import SidebarSettingsSection from '@/components/layout/SidebarSettingsSection';

export default function SidebarSettingsNav({ projectKey }: { projectKey: string | null }) {
  const sections = useSidebarSettingsNavItems(projectKey);

  return (
    <>
      {sections.map((section) => (
        <SidebarSettingsSection
          key={section.key}
          label={section.label}
          items={section.items}
          disabled={!projectKey}
        />
      ))}
    </>
  );
}

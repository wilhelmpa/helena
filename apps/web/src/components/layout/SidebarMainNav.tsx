import SidebarAiTeamNav from '@/components/layout/SidebarAiTeamNav';
import SidebarConfigNav from '@/components/layout/SidebarConfigNav';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';

// The main sidebar body: the work navigation, the AI Team group, then the
// Configuration group.
export default function SidebarMainNav({ projectKey }: { projectKey: string | null }) {
  return (
    <>
      <SidebarWorkNav projectKey={projectKey} />
      <SidebarAiTeamNav projectKey={projectKey} />
      <SidebarConfigNav projectKey={projectKey} />
    </>
  );
}

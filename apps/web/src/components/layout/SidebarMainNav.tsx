import SidebarConfigNav from '@/components/layout/SidebarConfigNav';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';

export default function SidebarMainNav({ projectKey }: { projectKey: string | null }) {
  return (
    <>
      <SidebarWorkNav projectKey={projectKey} />
      <SidebarConfigNav projectKey={projectKey} />
    </>
  );
}

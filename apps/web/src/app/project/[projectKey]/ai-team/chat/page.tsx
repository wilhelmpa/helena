import { redirect } from 'next/navigation';
import { chatPath } from '@/utils/paths';

// The chat has its own page now (see /project/:projectKey/chat), so this old path
// sends the viewer straight there instead of the tool panel's chat.
export default async function Page({ params }: { params: Promise<{ projectKey: string }> }) {
  const { projectKey } = await params;
  redirect(chatPath(projectKey));
}

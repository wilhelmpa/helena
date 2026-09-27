import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ projectKey: string }> }) {
  const { projectKey } = await params;
  redirect(`/inbox?project=${encodeURIComponent(projectKey)}`);
}

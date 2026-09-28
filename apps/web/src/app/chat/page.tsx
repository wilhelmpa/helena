import { redirect } from 'next/navigation';
import { homeChatPath } from '@/utils/paths';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; thread?: string }>;
}) {
  const { agent, thread } = await searchParams;
  const agentId = agent ? Number(agent) : null;
  redirect(homeChatPath({ agent: Number.isFinite(agentId) ? agentId : null, thread }));
}

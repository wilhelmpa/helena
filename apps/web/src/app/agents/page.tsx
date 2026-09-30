import { redirect } from 'next/navigation';
import { teamListPath, teamOrganizationPath } from '@/utils/paths';
import { agentAddressQuery } from '@/utils/legacyAgentAddress';

// The agent pool is the list view of Team now (Auftrag 117); an old address (a bookmark,
// a chat command's ?agent=7&tab=runs) lands there with what it named: the agent open in the
// overlay (utils/legacyAgentAddress.ts), also after a reload.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(teamListPath(teamOrganizationPath(), agentAddressQuery(await searchParams)));
}

// Where a tap on a push leads: paths of the web app (apps/web/src/utils/paths.ts), relative,
// so the service worker opens them on the origin the device subscribed on.

// Administrator → Server, one route per tab.
export const serverPath = (tab = 'overview') => `/god/server/${tab}`;

export const approvalsPath = () => '/approvals';

export const issuePath = (projectKey: string, sequenceNumber: number) =>
  `/project/${projectKey}/issue/${sequenceNumber}`;

export function chatPath(location: { agent?: number | null; thread?: string | null }): string {
  const query = new URLSearchParams();
  if (location.agent != null) query.set('agent', String(location.agent));
  if (location.thread) query.set('thread', location.thread);
  const search = query.toString();
  return `/chat${search ? `?${search}` : ''}`;
}

export const activityPath = () => '/activity';

export const notificationSettingsPath = () => '/account/notifications';

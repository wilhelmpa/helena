import { getProjectProvisioning } from '@/lib/api/endpoints/projects';
import { browserAction, browserControlBase } from './browserControl';
import { runtimeEnv } from './runtimeEnv';
import { workspaceTools } from './workspaceTools';
import { webLinkKind } from './webLinkNavigation';
import type { WebLinkScope } from './webLinkScope';

export class WebLinkOpenError extends Error {
  constructor(readonly reason: 'linkScopeMissing' | 'linkBrowserUnavailable' | 'unsafe') {
    super(reason);
  }
}

// Uses the exact same configured/provisioned endpoint as WorkspacePanel. The browser
// router still authenticates the reader and checks their source-project permissions.
export async function openProjectWebLink(url: string, scope: WebLinkScope) {
  if (webLinkKind(url, window.location.href) !== 'web') throw new WebLinkOpenError('unsafe');
  if (scope === undefined || (scope !== null && !/^[A-Z][A-Z0-9_-]{0,31}$/i.test(scope))) {
    throw new WebLinkOpenError('linkScopeMissing');
  }
  const source = scope === null ? null : scope.toUpperCase();
  const config = runtimeEnv().workspace;
  const endpoint = (resources?: Parameters<typeof workspaceTools>[2]) =>
    browserControlBase(workspaceTools(config, source, resources).browser.url);
  let base = endpoint();
  if (!base && source !== null) {
    const job = await getProjectProvisioning(source);
    if (job.status === 'succeeded') base = endpoint(job.result?.resources);
  }
  if (!base) throw new WebLinkOpenError('linkBrowserUnavailable');
  await browserAction(base, 'new', { url });
  return { base, source };
}

import { createHash } from 'node:crypto';
// Match an owner's free-text approval to one observed Squarespace domain renewal action.
export function renewalDomainApproved(
  action: string,
  pagePath: string | null,
  groundedElement: string | null,
): boolean {
  if (!pagePath || !groundedElement) return false;
  if (
    !/(?:disable|deactivat|turn\s+off|stop|cancel|deaktivier|deaktivierung|ausschalt|kündig)/i.test(
      groundedElement,
    ) ||
    !/(?:automatic\s+renewal|auto[\s-]?renewal|automatische[nrsm]?\s+verlängerung|autoverlängerung)/i.test(
      groundedElement,
    )
  )
    return false;
  if (
    !/(?:disable|deactivat|turn\s+off|stop|cancel|deaktivier|deaktivierung|ausschalt|abschalt|kündig)/i.test(
      action,
    )
  )
    return false;
  const domains = action.toLowerCase().match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/g) ?? [];
  if (domains.length !== 1) return false;
  try {
    return pagePath
      .split('/')
      .some((part) => decodeURIComponent(part).toLowerCase() === domains[0]);
  } catch {
    return false;
  }
}

// The current URL path can identify one domain without reading a page query or secret.
export function renewalDomainInPath(pagePath: string | null): string | null {
  if (!pagePath) return null;
  try {
    const domains = pagePath
      .split('/')
      .map(decodeURIComponent)
      .filter((part) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(part));
    return domains.length === 1 ? domains[0]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

// A new approval can be bound to the exact observed control in its follow-up run.
export function browserApprovalCommand(
  category: string,
  context: {
    tool: string;
    origin: string | null;
    pagePath: string | null;
    groundedElement: string | null;
  },
): string | null {
  if (!context.origin || !context.pagePath || !context.groundedElement) return null;
  const action = JSON.stringify({
    browser: context.tool,
    category,
    origin: context.origin,
    path: context.pagePath,
    control: context.groundedElement,
  });
  return 'browser-action:sha256:' + createHash('sha256').update(action).digest('hex');
}

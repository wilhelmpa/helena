import { toolsFullyObserved } from '@helena/sdk';

export const taintSourcePatterns: Readonly<Record<string, RegExp>> = {
  mail: /mail|gmail|outlook|imap/i,
  browser: /browser|browse|navigate|screenshot|page_content/i,
  web: /webfetch|websearch|web_fetch|web_search|web_extract|fetch_url|search_web|crawl/i,
  knowledge:
    /knowledge|vault|document|evidence|search_docs|read_doc|memory|session_search|skill_view|vision_analyze|delegate_task/i,
  execution: /^(terminal|bash|shell|execute_code|exec|run_command|cronjob_manage)$/i,
};

export function taintSourcesOf(input: {
  tool: string;
  externalMcp?: boolean;
  path?: string;
  workspaceRoots?: string[];
}): string[] {
  const sources = Object.entries(taintSourcePatterns)
    .filter(([, pattern]) => pattern.test(input.tool))
    .map(([name]) => name);
  if (input.externalMcp) sources.push('external-mcp');
  if (/read|glob|grep|file|notebook|^ls$/i.test(input.tool)) {
    // Only canonical paths supplied by the server may establish workspace provenance.
    if (
      !input.path ||
      !input.workspaceRoots?.some(
        (root) => input.path === root || input.path!.startsWith(root + '/'),
      )
    ) {
      sources.push('outside-workspace');
    }
  }
  return sources;
}

export function rootDecision(input: {
  origin: string;
  runtime: string | null;
  taintSources: string[];
  directOnly: boolean;
}): 'immediate' | 'approval' {
  return toolsFullyObserved(input.runtime ?? '') &&
    input.taintSources.length === 0 &&
    (!input.directOnly || input.origin === 'owner-direct')
    ? 'immediate'
    : 'approval';
}

export function persistenceMarkers(command: string): string[] {
  return [
    ...(/\bsystemctl\s+(?:[^\n;]*\s)?(?:start|enable|restart)\b/.test(command) ? ['service'] : []),
    ...(/\bcron(?:tab)?\b|\/etc\/cron/.test(command) ? ['cron'] : []),
    ...(/sudoers/.test(command) ? ['sudoers'] : []),
  ];
}

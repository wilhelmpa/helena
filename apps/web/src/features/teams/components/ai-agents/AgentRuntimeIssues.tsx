'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { RuntimeIssue } from '@/lib/api/endpoints/agentRuntimeSync';
import { copyText } from '@/utils/clipboard';
import { credentialsPath } from '@/utils/paths';

// What keeps a Claude Code or Codex agent's runtime from its work, with what the owner does
// about it: sign it in (a runtime login in Zugänge, or the command the runner names for
// the owner terminal), install it, or switch agent isolation on for Codex.
export default function AgentRuntimeIssues({
  adapter,
  issues,
}: {
  adapter: string | null;
  issues: RuntimeIssue[];
}) {
  const t = useTranslations('teams.agents.profileSync');
  if (issues.length === 0) return null;
  const runtime = adapter === 'codex' ? 'codex' : 'claude';
  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li key={issue.code} className="space-y-1.5 text-sm">
          <p className={issue.code === 'sandbox-unavailable' ? undefined : 'text-destructive'}>
            {issue.code === 'not-signed-in'
              ? t(issue.detail === 'rejected' ? 'issues.rejected' : 'issues.notSignedIn')
              : issue.code === 'runtime-missing'
                ? t('issues.runtimeMissing', { runtime: t(`runtimes.${runtime}`) })
                : t('issues.sandboxUnavailable')}
          </p>
          {issue.code === 'not-signed-in' && (
            <>
              <p className="text-xs text-muted-foreground">{t(`signIn.${runtime}`)}</p>
              {issue.command && <SignInCommand command={issue.command} />}
              <Button asChild size="sm" variant="outline">
                <Link href={credentialsPath()}>{t('openAccess')}</Link>
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function SignInCommand({ command }: { command: string }) {
  const t = useTranslations('teams.agents.profileSync');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The browser can refuse the clipboard; the command can still be selected.
    }
  }
  return (
    <div className="flex items-start gap-2">
      <code
        dir="ltr"
        className="min-w-0 flex-1 rounded-md border border-sidebar-border bg-background px-2 py-1.5 font-mono text-xs break-all"
      >
        {command}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={copied ? t('copied') : t('copyCommand')}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

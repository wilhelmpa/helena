import { ExternalLink, File, GitPullRequest, Image, Monitor } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RunDetail } from '@/lib/api/endpoints/agentRuntime';
import { Card } from '@/components/helena/Card';

const icons = { file: File, preview: Monitor, pr: GitPullRequest, screenshot: Image };

export default function RunResults({ run }: { run: RunDetail }) {
  const t = useTranslations('agentRuntime.runs');
  return (
    <section aria-labelledby="run-results-title" className="space-y-3">
      <h2 id="run-results-title" className="text-sm font-semibold">
        {t('results')}
      </h2>
      {run.output ? (
        <p className="text-sm whitespace-pre-wrap" dir="auto">
          {run.output}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noSummary')}</p>
      )}
      {run.outputs.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {run.outputs.map((output) => {
            const Icon = icons[output.kind];
            const link = /^https?:\/\//i.test(output.target);
            const content = (
              <>
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    {t(`outputKind.${output.kind}`)}
                  </span>
                  <span className="block truncate text-sm font-medium" title={output.target}>
                    {output.title}
                  </span>
                </span>
                {link && <ExternalLink aria-hidden="true" className="size-4 shrink-0" />}
              </>
            );
            const className = 'flex min-w-0 flex-row items-center gap-3 p-3';
            return link ? (
              <Card key={output.id} className={className}>
                <a
                  className="flex min-w-0 flex-1 items-center gap-3"
                  href={output.target}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {content}
                </a>
              </Card>
            ) : (
              <Card key={output.id} className={className}>
                {content}
              </Card>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noOutputs')}</p>
      )}
    </section>
  );
}

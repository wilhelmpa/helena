import { ExternalLink, File, GitPullRequest, Image, Monitor } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RunDetail } from '@/lib/api/endpoints/agentRuntime';

const icons = { file: File, preview: Monitor, pr: GitPullRequest, screenshot: Image };

// What a run delivered, first (owner P6): its closing answer, then one card per result it
// reported or that was found — a file, a preview, a pull request, a screenshot. A card
// with a web address opens it.
export default function RunResults({ run }: { run: RunDetail }) {
  const t = useTranslations('agentRuntime.runs');
  return (
    <div className="ds-run-results">
      {run.output ? (
        <p className="ds-run-summary" dir="auto">
          {run.output}
        </p>
      ) : (
        <p className="ds-run-note">{t('noSummary')}</p>
      )}
      {run.outputs.length > 0 ? (
        <div className="ds-run-cards">
          {run.outputs.map((output) => {
            const Icon = icons[output.kind];
            const link = /^https?:\/\//i.test(output.target);
            const content = (
              <>
                <span className="ds-run-card-icon">
                  <Icon aria-hidden="true" size={16} />
                </span>
                <span className="ds-run-card-text">
                  <span className="ds-mono-label">{t(`outputKind.${output.kind}`)}</span>
                  <span className="ds-run-card-title" title={output.target}>
                    {output.title}
                  </span>
                </span>
                {link && <ExternalLink aria-hidden="true" size={14} />}
              </>
            );
            return link ? (
              <a
                key={output.id}
                className="ds-run-card"
                href={output.target}
                target="_blank"
                rel="noopener noreferrer"
              >
                {content}
              </a>
            ) : (
              <div key={output.id} className="ds-run-card">
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ds-run-note">{t('noOutputs')}</p>
      )}
    </div>
  );
}

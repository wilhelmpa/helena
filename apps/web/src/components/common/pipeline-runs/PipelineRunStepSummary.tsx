'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

// What the step reported. A long result is collapsed to its first lines, since an
// agent's result can run to pages.
export default function PipelineRunStepSummary({ summary }: { summary: string }) {
  const t = useTranslations('pipelines.runs');
  const [open, setOpen] = useState(false);
  const long = summary.length > 160 || summary.split('\n').length > 2;

  return (
    <div className="space-y-1">
      <p
        className={`whitespace-pre-wrap text-muted-foreground ${long && !open ? 'line-clamp-2' : ''}`}
        dir="auto"
      >
        {summary}
      </p>
      {long && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          {open ? t('hideResult') : t('showResult')}
        </button>
      )}
    </div>
  );
}

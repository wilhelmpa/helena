'use client';

import { useState } from 'react';
import { FlaskConical, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import PipelineTestRunDialog from './PipelineTestRunDialog';

// Test run and save. A test run runs the saved version, so it waits for a save; a
// draft with problems of its definition cannot be saved.
export default function PipelineEditorActions({
  pipeline,
  editable,
  dirty,
  blocked,
  busy,
  onSave,
}: {
  pipeline: Pipeline;
  editable: boolean;
  dirty: boolean;
  blocked: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  const t = useTranslations('pipelines');
  const [testing, setTesting] = useState(false);
  const hint = dirty ? t('testRun.saveFirst') : null;

  return (
    <>
      {editable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={dirty}
                onClick={() => setTesting(true)}
              >
                <FlaskConical /> {t('testRun.button')}
              </Button>
            </span>
          </TooltipTrigger>
          {hint && <TooltipContent>{hint}</TooltipContent>}
        </Tooltip>
      )}
      {editable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                className="h-8"
                disabled={!dirty || blocked || busy}
                onClick={onSave}
              >
                <Save /> {t('editor.save')}
              </Button>
            </span>
          </TooltipTrigger>
          {dirty && blocked && <TooltipContent>{t('editor.blocked')}</TooltipContent>}
        </Tooltip>
      )}
      {testing && <PipelineTestRunDialog pipeline={pipeline} onClose={() => setTesting(false)} />}
    </>
  );
}

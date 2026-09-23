import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StartablePipeline } from '@/lib/api/endpoints/pipelines';
import { useStartPipelineRun } from '@/services/pipelines.service';

export default function IssuePipelineStartMenu({
  issueId,
  pipelines,
}: {
  issueId: number;
  pipelines: StartablePipeline[];
}) {
  const t = useTranslations('pipelines.issuePanel');
  const start = useStartPipelineRun();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-muted-foreground hover:text-foreground"
          disabled={start.isPending}
        >
          <Play />
          {t('start')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        {pipelines.map((pipeline) => (
          <DropdownMenuItem
            key={pipeline.id}
            className="flex-col items-start gap-0.5"
            onSelect={() => start.mutate({ issueId, pipelineId: pipeline.id, dryRun: false })}
          >
            <span dir="auto">{pipeline.name}</span>
            {pipeline.description && (
              <span className="line-clamp-2 text-xs text-muted-foreground" dir="auto">
                {pipeline.description}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

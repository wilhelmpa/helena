'use client';

import { useState } from 'react';
import { Copy, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAiAgentsQuery, useCopyAiAgentTemplate } from '@/services/aiAgents.service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AgentKeyValue from './AgentKeyValue';

// Adds a specialist to the project as a copy of one of the team's templates. An
// external copy's key exists only in the answer, so the dialog shows it once before
// it closes.
export default function ProjectAgentTemplateDialog({
  teamId,
  projectId,
}: {
  teamId: number;
  projectId: number;
}) {
  const t = useTranslations('settings.agents');
  const tAgents = useTranslations('teams.agents');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const templates = (useAiAgentsQuery(teamId).data ?? []).filter((agent) => agent.template);
  const copy = useCopyAiAgentTemplate(teamId);

  if (templates.length === 0) return null;

  function openDialog() {
    setTemplateId(null);
    setApiKey(null);
    setOpen(true);
  }

  async function add() {
    if (templateId == null) return;
    const res = await copy.mutateAsync({ templateId, projectId });
    if (res.apiKey) setApiKey(res.apiKey);
    else setOpen(false);
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openDialog}>
        <Copy className="size-3.5" />
        {t('newFromTemplate')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newFromTemplate')}</DialogTitle>
            <DialogDescription>{t('templateDialogDescription')}</DialogDescription>
          </DialogHeader>
          {apiKey ? (
            <div className="space-y-2.5 rounded-md bg-warning/5 p-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="min-w-0 flex-1 text-xs">{tAgents('keyWarning')}</p>
              </div>
              <AgentKeyValue apiKey={apiKey} />
            </div>
          ) : (
            <div className="grid gap-2 py-2">
              <Label htmlFor="agent-template">{t('template')}</Label>
              <Select
                value={templateId?.toString()}
                onValueChange={(value) => setTemplateId(Number(value))}
              >
                <SelectTrigger id="agent-template" className="w-full">
                  <SelectValue placeholder={t('chooseTemplate')} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            {apiKey ? (
              <Button onClick={() => setOpen(false)}>{tAgents('done')}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={copy.isPending}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  onClick={() => void add().catch(() => undefined)}
                  disabled={templateId == null || copy.isPending}
                >
                  {t('addSpecialist')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

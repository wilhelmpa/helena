'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
// it closes. Mounted while open (its trigger is the page's toolbar action), so every
// opening starts from a blank choice.
export default function ProjectAgentTemplateDialog({
  teamId,
  projectId,
  onClose,
}: {
  teamId: number;
  projectId: number;
  onClose: () => void;
}) {
  const t = useTranslations('settings.agents');
  const tAgents = useTranslations('teams.agents');
  const tCommon = useTranslations('common');
  const tModel = useTranslations('modelAvailability');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const templates = (useAiAgentsQuery(teamId).data ?? []).filter((agent) => agent.template);
  const copy = useCopyAiAgentTemplate(teamId);

  async function add() {
    if (templateId == null) return;
    const res = await copy.mutateAsync({ templateId, projectId });
    // The template's model was refused for this account: the copy runs on the default.
    if (res.modelFallback)
      toast.warning(
        tModel('copyFallback', { name: res.agent.name, model: res.modelFallback.model }),
        { description: res.modelFallback.detail ?? undefined },
      );
    if (res.apiKey) setApiKey(res.apiKey);
    else onClose();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
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
            <Button onClick={onClose}>{tAgents('done')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={copy.isPending}>
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
  );
}

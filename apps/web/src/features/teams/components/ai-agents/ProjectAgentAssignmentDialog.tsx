'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent, AgentProject } from '@/lib/api/endpoints/agents';
import { useSetMemberDescription, useSetMemberRole } from '@/services/members.service';
import { useTeamRoleOptionsQuery } from '@/services/roles.service';
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
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function ProjectAgentAssignmentDialog({
  agent,
  assignment,
  projectKey,
  teamId,
}: {
  agent: AiAgent;
  assignment: AgentProject;
  projectKey: string;
  teamId: number;
}) {
  const t = useTranslations('settings.agents');
  const tMembers = useTranslations('members');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState<number | null>(assignment.roleId);
  const [instructions, setInstructions] = useState(assignment.instructions);
  const rolesQuery = useTeamRoleOptionsQuery(open ? teamId : null);
  const setRole = useSetMemberRole(projectKey);
  const setDescription = useSetMemberDescription(projectKey);
  const roles = rolesQuery.data ?? [];
  const defaultRole = roles.find((role) => role.isDefault) ?? null;
  const selectedRoleId = roleId ?? defaultRole?.id ?? null;
  const saving = setRole.isPending || setDescription.isPending;

  function openDialog() {
    setRoleId(assignment.roleId);
    setInstructions(assignment.instructions);
    setOpen(true);
  }

  async function save() {
    const nextInstructions = instructions.trim();
    const writes: Promise<unknown>[] = [];
    if (roleId !== assignment.roleId) {
      writes.push(setRole.mutateAsync({ userId: agent.userId, role: 'member', roleId }));
    }
    if (nextInstructions !== assignment.instructions) {
      writes.push(
        setDescription.mutateAsync({ userId: agent.userId, description: nextInstructions }),
      );
    }
    try {
      await Promise.all(writes);
      setOpen(false);
    } catch {
      // The global mutation handler reports the error; keep the editor open.
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={openDialog}
            aria-label={t('editAssignment')}
          >
            <Pencil className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('editAssignment')}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editAssignment')}</DialogTitle>
            <DialogDescription>
              {t('assignmentDescription', { name: agent.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor={`agent-role-${agent.id}`}>{t('projectRole')}</Label>
              <Select
                value={selectedRoleId?.toString()}
                onValueChange={(value) => setRoleId(Number(value))}
                disabled={rolesQuery.isPending || roles.length === 0}
              >
                <SelectTrigger id={`agent-role-${agent.id}`} className="w-full">
                  <SelectValue placeholder={tMembers('selectRole')} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`agent-instructions-${agent.id}`}>{t('projectInstructions')}</Label>
              <Textarea
                id={`agent-instructions-${agent.id}`}
                value={instructions}
                maxLength={500}
                rows={7}
                placeholder={t('projectInstructionsPlaceholder')}
                onChange={(event) => setInstructions(event.target.value)}
              />
              <p className="text-end text-xs text-muted-foreground">{instructions.length}/500</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={saving || roles.length === 0}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

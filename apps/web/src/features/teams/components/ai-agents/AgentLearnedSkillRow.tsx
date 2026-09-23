import { useState } from 'react';
import { MoreHorizontal, Pin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';
import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { useQueueRuntimeAction } from '../../services/agentLearning.service';
import { actionOn, pinnedAfter, SKILL_ACTIONS } from '../../utils/agentLearning';
import AgentLearnedSkillDialog from './AgentLearnedSkillDialog';
import AgentRuntimeActionState from './AgentRuntimeActionState';

// A skill the agent created, with what the owner can do about it: read it, take it into
// the team's library, pin it against Hermes' review and curator, or discard it.
export default function AgentLearnedSkillRow({
  skill,
  path,
  agentId,
  actions,
  onPromoted,
}: {
  skill: AgentInventorySkill;
  path: string;
  agentId: number;
  actions: RuntimeAction[] | undefined;
  onPromoted: (skillId: number) => void;
}) {
  const t = useTranslations('teams.agents.abilities.learning');
  const tOrigin = useTranslations('teams.agents.abilities.origin');
  const { teamId } = useAgentSection();
  const canEdit = useAgentCan()('edit');
  const queue = useQueueRuntimeAction(teamId, agentId);
  const [open, setOpen] = useState<'view' | 'discard' | null>(null);
  const action = actionOn(actions, path, SKILL_ACTIONS);
  const pinned = pinnedAfter(skill.pinned ?? false, action);

  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0" dir="auto">
        <span className="text-sm">{skill.name}</span>
        {skill.description && (
          <span className="block text-xs text-muted-foreground">{skill.description}</span>
        )}
        <AgentRuntimeActionState action={action} />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {pinned && <Pin className="size-3.5 text-muted-foreground" aria-label={t('pinned')} />}
        <Badge variant="secondary">{tOrigin('agent')}</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t('menu', { name: skill.name })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setOpen('view')}>{t('view')}</DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem
                onSelect={() => queue.mutate({ kind: 'pin-skill', path, pinned: !pinned })}
              >
                {t(pinned ? 'unpin' : 'pin')}
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen('discard')}>
                {t('discard')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      {open === 'view' && (
        <AgentLearnedSkillDialog
          agentId={agentId}
          path={path}
          name={skill.name}
          onPromoted={onPromoted}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'discard' && (
        <ConfirmDialog
          title={t('discardTitle', { name: skill.name })}
          confirmLabel={t('discard')}
          onConfirm={async () => {
            await queue.mutateAsync({ kind: 'discard-skill', path });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        >
          <p className="text-sm text-muted-foreground">{t('discardBody')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

import { useTranslations } from 'next-intl';
import Markdown from '@/components/common/Markdown';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useTeamQuery } from '@/services/teams.service';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { useLearnedSkillQuery, usePromoteLearnedSkill } from '../../services/agentLearning.service';

// The content of a skill the agent created, as its runner last reported it, and the way
// to take it into the team's library.
export default function AgentLearnedSkillDialog({
  agentId,
  path,
  name,
  onPromoted,
  onClose,
}: {
  agentId: number;
  path: string;
  name: string;
  onPromoted: (skillId: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations('teams.agents.abilities.learning');
  const tCommon = useTranslations('common');
  const { teamId } = useAgentSection();
  // Taking a skill over also enables it on the agent and discards the agent's copy.
  const skillRights = useTeamQuery(teamId).data?.permissions.agent_skills;
  const canPromote =
    useAgentCan()('edit') && (skillRights?.create ?? false) && (skillRights?.edit ?? false);
  const query = useLearnedSkillQuery(teamId, agentId, path);
  const promote = usePromoteLearnedSkill(teamId, agentId);
  const skill = query.data;

  return (
    <Modal title={name} crumb={path} onClose={onClose} wide>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pe-1">
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        ) : !skill || skill.truncated ? (
          <p className="text-sm text-muted-foreground">{t('tooLarge')}</p>
        ) : (
          <>
            <div className="rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm">
              <Markdown>{skill.markdown}</Markdown>
            </div>
            {skill.files.map((file) => (
              <div key={file.path} className="space-y-1.5">
                <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                  {file.path}
                </p>
                <div className="rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm">
                  <Markdown>{file.content}</Markdown>
                </div>
              </div>
            ))}
            {skill.otherFiles > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('otherFiles', { count: skill.otherFiles })}
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          {tCommon('close')}
        </Button>
        {canPromote && skill && !skill.truncated && skill.otherFiles === 0 && (
          <Button
            type="button"
            disabled={promote.isPending}
            onClick={() =>
              promote.mutate(path, {
                onSuccess: (created) => {
                  onPromoted(created.id);
                  onClose();
                },
              })
            }
          >
            {t('promote')}
          </Button>
        )}
      </div>
    </Modal>
  );
}

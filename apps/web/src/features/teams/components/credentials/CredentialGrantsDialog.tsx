import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import Modal from '@/components/common/overlay/Modal';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useSetCredentialGrants } from '@/services/credentials.service';
import { grantableAgentGroups } from '../../utils/credentialForm';
import { CredentialAgentGroup } from './CredentialAgentGroup';

// Picks the agents that may use a credential: the Home agent, the coordinators and the
// project agents. Their runners receive it before each run.
export function CredentialGrantsDialog({
  teamId,
  entry,
  onClose,
}: {
  teamId: number;
  entry: CredentialEntry;
  onClose: () => void;
}) {
  const t = useTranslations('credentials');
  const tCommon = useTranslations('common');
  const agents = useAiAgentsQuery(teamId).data;
  const [selected, setSelected] = useState(() => new Set(entry.agentIds));
  const save = useSetCredentialGrants(teamId);
  const groups = agents ? grantableAgentGroups(agents, entry.projectId) : null;

  function toggle(agentId: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(agentId);
      else next.delete(agentId);
      return next;
    });
  }

  async function submit() {
    try {
      await save.mutateAsync({ id: entry.id, agentIds: [...selected] });
      onClose();
    } catch {
      // The failure is toasted; the choice stays as it was made.
    }
  }

  return (
    <Modal title={t('grantsTitle', { name: entry.label })} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {entry.projectKey
            ? `${t('grantsHint')} ${t('grantsProjectHint', { project: entry.projectKey })}`
            : t('grantsHint')}
        </p>
        {!groups ? (
          <ListSkeleton rows={3} rowClassName="h-9" />
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noAgents')}</p>
        ) : (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto">
            {groups.map((group) => (
              <CredentialAgentGroup
                key={group.project?.id ?? 'none'}
                group={group}
                selected={selected}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={submit} disabled={!groups || save.isPending}>
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

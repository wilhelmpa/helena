'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import NameDialog from '@/components/common/overlay/NameDialog';
import { Button } from '@/components/ui/button';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { addRole } from '../../utils/editorState';
import PipelineCard from './PipelineCard';
import PipelineRoleRow from './PipelineRoleRow';
import { Text } from '@/design-system';

export default function PipelineRolesCard() {
  const t = useTranslations('pipelines.roles');
  const { definition, editable, change } = usePipelineEditor();
  const [adding, setAdding] = useState(false);

  return (
    <PipelineCard
      title={t('title')}
      hint={t('hint')}
      action={
        editable && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setAdding(true)}>
            <Plus /> {t('add')}
          </Button>
        )
      }
    >
      {definition.roles.length === 0 ? (
        <Text as="p" size="sm" tone="muted">
          {t('empty')}
        </Text>
      ) : (
        <ul className="divide-y">
          {definition.roles.map((role) => (
            <PipelineRoleRow key={role.key} role={role} />
          ))}
        </ul>
      )}
      {adding && (
        <NameDialog
          title={t('newRole')}
          label={t('name')}
          maxLength={80}
          submitLabel={t('add')}
          onSubmit={async (name) => change((current) => addRole(current, name))}
          onClose={() => setAdding(false)}
        />
      )}
    </PipelineCard>
  );
}

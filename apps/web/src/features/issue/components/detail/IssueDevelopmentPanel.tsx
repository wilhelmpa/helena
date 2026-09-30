import { Card } from '@/design-system';
import { useState } from 'react';
import type { DevelopmentLink } from '@/lib/api/endpoints/git';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import IssueDevelopmentAddMenu from './IssueDevelopmentAddMenu';
import IssueDevelopmentCreateDialog from './IssueDevelopmentCreateDialog';
import IssueDevelopmentLinkCard from './IssueDevelopmentLinkCard';
import IssueDevelopmentLinkDialog from './IssueDevelopmentLinkDialog';
import IssueSectionHeading from './IssueSectionHeading';
import { useTranslations } from 'next-intl';

export default function IssueDevelopmentPanel({
  issueId,
  identifier,
  issueTitle,
  links,
  canEdit,
  canManage,
}: {
  issueId: number;
  identifier: string;
  issueTitle: string;
  links: DevelopmentLink[];
  canEdit: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('issue.development');
  const { open, toggle } = usePersistedOpen('issue-development-open');
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  if (links.length === 0 && !canManage) return null;

  return (
    <div className={`mt-6 border-t pt-5 ${open ? '' : '-mb-2'}`}>
      <div className={`flex h-7 items-center justify-between gap-3 ${open ? 'mb-3' : ''}`}>
        <IssueSectionHeading
          label={t('title')}
          tally={String(links.length)}
          open={open}
          onToggle={toggle}
        />
        {canManage && (
          <IssueDevelopmentAddMenu
            onLink={() => setLinkOpen(true)}
            onCreate={() => setCreateOpen(true)}
          />
        )}
      </div>
      {open && (
        <div className="space-y-2">
          {links.length === 0 && (
            <Card
              as="button"
              type="button"
              tone="inset"
              interactive
              className="w-full items-center text-center text-sm text-muted-foreground"
              onClick={() => setLinkOpen(true)}
            >
              {t('empty')}
            </Card>
          )}
          {links.map((link) => (
            <IssueDevelopmentLinkCard
              key={link.id}
              issueId={issueId}
              link={link}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
      <IssueDevelopmentLinkDialog issueId={issueId} open={linkOpen} onOpenChange={setLinkOpen} />
      <IssueDevelopmentCreateDialog
        issueId={issueId}
        identifier={identifier}
        issueTitle={issueTitle}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}

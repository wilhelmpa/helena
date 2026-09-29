'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Role } from '@/lib/api/endpoints/roles';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionsPopover } from '@/components/common/permissions/PermissionsPopover';
import DeleteRoleDialog from './DeleteRoleDialog';
import TableCard from '@/components/common/page/TableCard';
import { Table, Td, Th, Tr } from '@/design-system';

// The team's roles, one row each: what it grants, and the actions to edit or delete
// it. Deleting is the owner's, so a manager gets the row without that action. The
// default role cannot be deleted; deleting any other one moves what is on it to a
// role the dialog asks for, which is why it is handed every role of the team and not
// only the page on screen.
export default function TeamRolesList({
  teamId,
  roles,
  allRoles,
  pending,
  canEdit,
  canDelete,
  searchTerm,
  onEdit,
}: {
  teamId: number;
  roles: Role[];
  allRoles: Role[];
  pending: boolean;
  canEdit: boolean;
  canDelete: boolean;
  searchTerm: string | undefined;
  onEdit: (role: Role) => void;
}) {
  const t = useTranslations('teams');
  const tCommon = useTranslations('common');
  const [deleting, setDeleting] = useState<Role | null>(null);

  if (pending) return <ListSkeleton rows={2} rowClassName="h-12" />;
  if (roles.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {searchTerm === undefined ? t('roles.empty') : t('roles.noMatches', { query: searchTerm })}
      </p>
    );

  return (
    <div className="overflow-x-auto">
      <TableCard>
        <Table stack={false} className="table-fixed xl:min-w-[560px]">
          <colgroup>
            <col className="w-[56%]" />
            <col className="w-[26%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>{t('columns.role')}</Th>
              <Th>{t('columns.permissions')}</Th>
              <Th alignment="end">{tCommon('actions')}</Th>
            </Tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <Tr
                key={role.id}
                className={canEdit ? 'cursor-pointer' : undefined}
                onClick={() => canEdit && onEdit(role)}
              >
                <Td className="py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{role.name}</span>
                    {role.isDefault && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 px-1.5 py-0 text-xs font-normal"
                      >
                        {t('roles.default')}
                      </Badge>
                    )}
                  </div>
                </Td>

                <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                  <PermissionsPopover permissions={role.permissions} />
                </Td>

                <Td onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      disabled={!canEdit}
                      aria-label={t('roles.editAction')}
                      title={t('roles.editAction')}
                      onClick={() => onEdit(role)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    {canDelete && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              disabled={role.isDefault}
                              aria-label={t('roles.deleteAction')}
                              onClick={() => setDeleting(role)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {role.isDefault ? t('roles.defaultUndeletable') : t('roles.deleteAction')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableCard>

      {deleting && (
        <DeleteRoleDialog
          teamId={teamId}
          role={deleting}
          roles={allRoles}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

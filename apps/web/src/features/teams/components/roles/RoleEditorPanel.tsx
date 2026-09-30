'use client';

import { Fragment, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  PermissionAction,
  PermissionCatalog,
  PermissionResource,
  Permissions,
  Role,
} from '@/lib/api/endpoints/roles';
import { useCreateRole, useUpdateRole } from '@/services/roles.service';
import { MatrixCheckbox } from './MatrixCheckbox';
import {
  catalogSupport,
  groupResources,
  matrixFromCatalog,
  orderActions,
} from '@/utils/permissions';
import { usePermissionLabels } from '@/hooks/usePermissionLabels';
import { Button, Field, Overlay, Table, TextField, Th, Tr, Td } from '@/design-system';

// The check state of a set of cells: all on, all off, or mixed.
function triState(values: boolean[]): boolean | 'indeterminate' {
  if (values.length > 0 && values.every(Boolean)) return true;
  if (values.some(Boolean)) return 'indeterminate';
  return false;
}

// Create or edit a role of a team in a right-hand side panel, over the team panel
// it was opened from (the one overlay, Esc closes it). The permission matrix
// groups resources and offers quick toggles per column (all resources) and per
// group. On failure the reason is toasted globally and the panel stays open.
export default function RoleEditorPanel({
  teamId,
  role,
  catalog,
  onClose,
}: {
  teamId: number;
  role: Role | null;
  catalog: PermissionCatalog;
  onClose: () => void;
}) {
  const t = useTranslations('teams.roles');
  const tCommon = useTranslations('common');
  const { actionLabel, resourceLabel, groupLabel } = usePermissionLabels();
  const [name, setName] = useState(role?.name ?? '');
  const [matrix, setMatrix] = useState<Permissions>(() =>
    matrixFromCatalog(catalog, role?.permissions),
  );
  const createRole = useCreateRole(teamId);
  const updateRole = useUpdateRole(teamId);
  const busy = createRole.isPending || updateRole.isPending;

  const supports = useMemo(() => catalogSupport(catalog), [catalog]);
  const resourceKeys = useMemo(() => catalog.resources.map((r) => r.key), [catalog.resources]);
  const groups = useMemo(() => groupResources(resourceKeys), [resourceKeys]);
  const actions = useMemo(() => orderActions(catalog.actions), [catalog.actions]);

  // Set `value` on every supported (resource, action) pair in the given sets.
  function apply(resources: PermissionResource[], actions: PermissionAction[], value: boolean) {
    setMatrix((m) => {
      const next = { ...m };
      for (const resource of resources) {
        next[resource] = { ...next[resource] };
        for (const action of actions) {
          if (supports(resource, action)) next[resource][action] = value;
        }
      }
      return next;
    });
  }

  const cellsFor = (resources: PermissionResource[], actions: PermissionAction[]) =>
    resources.flatMap((r) => actions.filter((a) => supports(r, a)).map((a) => matrix[r][a]));

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (role)
        await updateRole.mutateAsync({
          roleId: role.id,
          patch: { name: trimmed, permissions: matrix },
        });
      else await createRole.mutateAsync({ name: trimmed, permissions: matrix });
      onClose();
    } catch {
      // The global handler toasts the reason (e.g. a duplicate name); stay open.
    }
  }

  const title = role ? t('editorTitleEdit') : t('editorTitleNew');
  return (
    <Overlay
      label={title}
      tabs={[{ id: 'role', label: title }]}
      onClose={onClose}
      className="ds-role-overlay"
      width="wide"
    >
      <div className="ds-overlay-form" data-role-editor>
        <Field label={tCommon('name')} htmlFor="role-name">
          <TextField
            id="role-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
          />
        </Field>

        <Table stack={false}>
          <thead>
            <Tr>
              <Th>{t('resourceColumn')}</Th>
              {actions.map((action) => {
                const state = triState(cellsFor(resourceKeys, [action]));
                return (
                  <Th key={action}>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {actionLabel(action)}
                      </span>
                      <MatrixCheckbox
                        checked={state}
                        onCheckedChange={() => apply(resourceKeys, [action], state !== true)}
                        title={t('toggleActionAll', { action: actionLabel(action) })}
                        aria-label={t('toggleActionAll', { action: actionLabel(action) })}
                      />
                    </div>
                  </Th>
                );
              })}
            </Tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const groupState = triState(cellsFor(group.resources, actions));
              return (
                <Fragment key={group.key}>
                  <Tr className="bg-muted/40">
                    <Td>
                      <div className="flex items-center gap-2">
                        <MatrixCheckbox
                          checked={groupState}
                          onCheckedChange={() =>
                            apply(group.resources, actions, groupState !== true)
                          }
                          title={t('toggleGroupAll', { group: groupLabel(group.key) })}
                          aria-label={t('toggleGroupAll', { group: groupLabel(group.key) })}
                        />
                        <span className="text-xs font-medium">{groupLabel(group.key)}</span>
                      </div>
                    </Td>
                    {actions.map((action) => {
                      const state = triState(cellsFor(group.resources, [action]));
                      return (
                        <Td alignment="center" key={action}>
                          <MatrixCheckbox
                            checked={state}
                            onCheckedChange={() => apply(group.resources, [action], state !== true)}
                            title={t('toggleActionGroup', {
                              action: actionLabel(action),
                              group: groupLabel(group.key),
                            })}
                            aria-label={t('toggleActionGroup', {
                              action: actionLabel(action),
                              group: groupLabel(group.key),
                            })}
                          />
                        </Td>
                      );
                    })}
                  </Tr>
                  {group.resources.map((resource) => (
                    <Tr key={resource}>
                      <Td>{resourceLabel(resource)}</Td>
                      {actions.map((action) => (
                        <Td alignment="center" key={action}>
                          {supports(resource, action) && (
                            <MatrixCheckbox
                              checked={matrix[resource][action]}
                              onCheckedChange={() =>
                                apply([resource], [action], !matrix[resource][action])
                              }
                              aria-label={t('cellAria', {
                                resource: resourceLabel(resource),
                                action: actionLabel(action),
                              })}
                            />
                          )}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </Table>

        <div className="ds-overlay-footer">
          <Button onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
            {role ? t('saveRole') : t('createRole')}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

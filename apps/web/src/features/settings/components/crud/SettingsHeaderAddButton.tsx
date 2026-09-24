'use client';

import { Plus } from 'lucide-react';
import type { PermissionResource } from '@/lib/api/endpoints/roles';
import type { PageAction } from '@/components/layout/PageToolbar';
import { usePermissions } from '@/hooks/usePermissions';

// A settings page's primary "add" action for its header row (SettingsToolbar), for
// sections whose create form is inline in the list rather than a dialog: the list owns
// the inline form, opened via lifted state. Gated on the section's create permission,
// so there is none for a user who cannot create.
export function useSettingsAddAction(
  resource: PermissionResource,
  label: string,
  onClick: () => void,
): Omit<PageAction, 'menuOnly'> | undefined {
  const { can } = usePermissions();
  return can(resource, 'create') ? { id: 'add', label, icon: Plus, onClick } : undefined;
}

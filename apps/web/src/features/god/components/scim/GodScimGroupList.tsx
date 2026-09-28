'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { InstanceScimGroup } from '@/lib/api/endpoints/scim';
import SettingsSection from '@/components/common/page/SettingsSection';
import { ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import GodScimGroupItem from './GodScimGroupItem';
import GodScimGroupMappingDialog from './GodScimGroupMappingDialog';
import { useInstanceScimGroupsQuery } from '../../services/god.service';

import { Box, Stack, Text } from '@/design-system';

// The groups the identity provider has pushed. The list itself is read-only — it is
// the provider's — and what each group grants is set here.
export default function GodScimGroupList() {
  const t = useTranslations('god.scim');
  const groups = useInstanceScimGroupsQuery();
  const [editing, setEditing] = useState<InstanceScimGroup | null>(null);

  return (
    <SettingsSection title={t('groups')} description={t('groupsHint')}>
      {groups.isPending ? (
        <Stack gap={2} padY={3}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Stack>
      ) : groups.data && groups.data.length > 0 ? (
        <ItemGroup>
          {groups.data.map((group) => (
            <GodScimGroupItem key={group.id} group={group} onEdit={() => setEditing(group)} />
          ))}
        </ItemGroup>
      ) : (
        <Box as="p" padY={4}>
          <Text as="span" size="sm" tone="muted">
            {t('groupsEmpty')}
          </Text>
        </Box>
      )}

      {editing && <GodScimGroupMappingDialog group={editing} onClose={() => setEditing(null)} />}
    </SettingsSection>
  );
}

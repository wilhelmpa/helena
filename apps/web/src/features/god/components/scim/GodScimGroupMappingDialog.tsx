'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { InstanceScimGroup } from '@/lib/api/endpoints/scim';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import GodScimMappingRow from './GodScimMappingRow';
import { useGodScimMappingForm } from '../../hooks/useGodScimMappingForm';
import { useInstanceProjectOptionsQuery } from '../../services/god.service';

import { Box, Stack, Text, Inline } from '@/design-system';

// What one provisioned group grants. Saving reconciles the membership of every
// project the change touched, so a project taken off this list loses the members the
// group put there.
export default function GodScimGroupMappingDialog({
  group,
  onClose,
}: {
  group: InstanceScimGroup;
  onClose: () => void;
}) {
  const t = useTranslations('god.scim.mappings');
  const tCommon = useTranslations('common');
  const form = useGodScimMappingForm(group);
  const projects = useInstanceProjectOptionsQuery();

  const available = (projects.data ?? []).filter(
    (project) => !form.takenProjectIds.includes(project.id),
  );

  async function save() {
    try {
      await form.save();
      toast.success(t('saved'));
      onClose();
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <Modal title={t('title', { group: group.displayName })} onClose={onClose}>
      <Stack gap={4}>
        <Text as="p" size="sm" tone="muted">
          {t('description')}
        </Text>

        {form.mappings.length === 0 ? (
          <Box as="p" padY={2}>
            <Text as="span" size="sm" tone="muted">
              {t('empty')}
            </Text>
          </Box>
        ) : (
          <Stack gap={3}>
            {form.mappings.map((mapping, index) => (
              <GodScimMappingRow
                key={mapping.projectId}
                mapping={mapping}
                projects={projects.data ?? []}
                onChange={(patch) => form.update(index, patch)}
                onRemove={() => form.remove(index)}
              />
            ))}
          </Stack>
        )}

        <Select value="" onValueChange={(value) => form.add(Number(value))}>
          <SelectTrigger className="w-full" disabled={available.length === 0}>
            <SelectValue placeholder={t('addProject')} />
          </SelectTrigger>
          <SelectContent>
            {available.map((project) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {project.name} ({project.key})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Inline gap={2} align="stretch" justify="end" className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={form.saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!form.dirty || form.saving}>
            {form.saving ? tCommon('saving') : tCommon('save')}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}

'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { OrganizationDepartment, OrganizationProject } from '@/lib/api/endpoints/organization';
import { useSetProjectAssignment } from '../services/organization.service';
import { Inline, ListRow, Text } from '@/design-system';

// One project in Organisation › Abteilungen: its name and the department it belongs to,
// chosen right in the row and saved at once (owner, O33: no form per project). The
// project's standing instructions for its agents live in the project's own settings
// (Projekt › Einstellungen › Agenten › Autopilot & Ausführung).
export default function OrganizationProjectCard({
  teamId,
  project,
  departments,
}: {
  teamId: number;
  project: OrganizationProject;
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');
  const save = useSetProjectAssignment(teamId);
  return (
    <ListRow
      title={
        <Inline as="span" gap={2}>
          <Text weight="medium" truncate dir="auto">
            {project.name}
          </Text>
          <Text size="xs" tone="faint" mono>
            {project.key}
          </Text>
        </Inline>
      }
      meta={
        <select
          className="ds-field ds-select-native"
          aria-label={t('fields.department')}
          value={project.departmentId?.toString() ?? ''}
          disabled={save.isPending}
          onChange={(event) =>
            save.mutate(
              {
                id: project.id,
                input: {
                  departmentId: event.target.value ? Number(event.target.value) : null,
                  instructions: project.instructions,
                },
              },
              { onSuccess: () => toast.success(t('projects.assignmentSaved')) },
            )
          }
        >
          <option value="">{t('values.none')}</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      }
    />
  );
}

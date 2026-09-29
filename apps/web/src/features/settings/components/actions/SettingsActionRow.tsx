import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ActionDef } from '@/lib/api/endpoints/actions';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useFilterFields } from '@/hooks/useFilterFields';
import { useEffectText } from '@/hooks/useEffectText';
import { describeEffect } from '@/utils/actions';
import { actionIcon } from '@/utils/actionIcons';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import SettingsIconButton from '../SettingsIconButton';
import { useSettingsCan } from '../../context/settingsPermission';

import { Inline, Stack, Text, Td, Tr } from '@/design-system';

export function SettingsActionRow({
  action,
  project,
  customFields,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
}: {
  action: ActionDef;
  project: ProjectDetail;
  customFields: CustomField[];
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations('settings.actions');
  const tCommon = useTranslations('common');
  const can = useSettingsCan();
  const { describeConditions } = useFilterFields(project.project.key);
  const effectText = useEffectText();
  const conditions = describeConditions(action.condition, project, customFields);
  const effects = describeEffect(action.effect, project, effectText);
  const Icon = actionIcon(action.icon);
  return (
    <Tr className="group/item">
      <Td className="py-3 align-top whitespace-normal">
        <Inline gap={3} align="start" className="flex min-w-0 items-start">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <Stack gap={2} padTop={1} className="flex min-w-0 flex-col">
            <Inline gap={2} wrap className="flex flex-wrap items-center">
              <Text as="span" size="sm" className="truncate font-medium">
                {action.name}
              </Text>
              <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal">
                {t(triggerLabel(action.trigger))}
              </Badge>
              <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
                {t('stepCount', { count: action.workflow.nodes.length })}
              </Badge>
            </Inline>
            {conditions.length > 0 ? (
              <Inline gap={1} wrap className="flex flex-wrap items-center">
                <Text as="span" size="xs" tone="muted">
                  {t('when')}
                </Text>
                {conditions.map((text, i) => (
                  <Badge key={i} variant="secondary" className="font-normal">
                    {text}
                  </Badge>
                ))}
              </Inline>
            ) : (
              <Text as="span" size="xs" tone="muted">
                {t('alwaysAvailable')}
              </Text>
            )}
          </Stack>
        </Inline>
      </Td>
      <Td className="py-3 pt-4 align-top whitespace-normal">
        {effects.length > 0 ? (
          <Inline gap={1} align="stretch" wrap className="flex flex-wrap">
            {effects.map((e) => (
              <Badge key={e.key} variant="secondary" className="font-normal">
                {e.text}
              </Badge>
            ))}
          </Inline>
        ) : (
          <Text as="span" size="xs" tone="muted">
            {t('noChanges')}
          </Text>
        )}
      </Td>
      <Td className="pt-3 align-top">
        <Inline gap={1} justify="end" className="flex items-center justify-end">
          {can('edit') && (
            <Switch
              checked={action.enabled}
              onCheckedChange={onToggle}
              aria-label={tCommon('enabled')}
            />
          )}
          {can('edit') && (
            <SettingsIconButton title={t('edit')} onClick={onEdit}>
              <Pencil className="size-4" />
            </SettingsIconButton>
          )}
          {can('create') && (
            <SettingsIconButton title={t('duplicate')} onClick={onDuplicate}>
              <Copy className="size-4" />
            </SettingsIconButton>
          )}
          {can('delete') && (
            <SettingsIconButton title={t('delete')} destructive onClick={onDelete}>
              <Trash2 className="size-4" />
            </SettingsIconButton>
          )}
        </Inline>
      </Td>
    </Tr>
  );
}

function triggerLabel(trigger: ActionDef['trigger']) {
  if (trigger === 'manual') return 'triggerManual' as const;
  if (trigger === 'issue_comment_added') return 'triggerCommentAdded' as const;
  return 'triggerStateChanged' as const;
}

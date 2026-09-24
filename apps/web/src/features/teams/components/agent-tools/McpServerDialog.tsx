import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useIntegrationOptionsQuery } from '@/services/integrations.service';
import { useCreateMcpServer, useUpdateMcpServer } from '@/services/agentMcpServers.service';
import {
  emptyMcpServerValue,
  isMcpServerFormValid,
  mcpServerValue,
  presetValue,
  toMcpServerInput,
  type McpServerFormValue,
} from '../../utils/mcpServerForm';
import { McpServerFields } from './McpServerFields';
import { McpServerPresetPicker } from './McpServerPresetPicker';

// Adds a server to the library, starting from a preset or from scratch, or edits one.
export function McpServerDialog({
  teamId,
  server,
  onClose,
}: {
  teamId: number;
  server: McpServer | null;
  onClose: () => void;
}) {
  const t = useTranslations('teams.mcpServers');
  const tCommon = useTranslations('common');
  const secrets = useIntegrationOptionsQuery(teamId, 'secret').data ?? [];
  const [value, setValue] = useState<McpServerFormValue | null>(
    server ? mcpServerValue(server) : null,
  );
  const create = useCreateMcpServer(teamId);
  const update = useUpdateMcpServer(teamId);
  const busy = create.isPending || update.isPending;

  if (!value) {
    return (
      <Modal title={t('add')} onClose={onClose}>
        <McpServerPresetPicker
          onSelect={(key) =>
            setValue(key ? presetValue(key, t(`presets.${key}`), secrets) : emptyMcpServerValue())
          }
        />
      </Modal>
    );
  }

  async function submit() {
    if (!value || !isMcpServerFormValid(value) || busy) return;
    const input = toMcpServerInput(value);
    try {
      if (server) await update.mutateAsync({ id: server.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch {
      // The failure is toasted; the dialog stays open with what was entered.
    }
  }

  return (
    <Modal title={server ? t('edit') : t('add')} onClose={onClose} wide>
      <div className="space-y-4">
        <McpServerFields
          value={value}
          secrets={secrets}
          onChange={(patch) => setValue((prev) => prev && { ...prev, ...patch })}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={submit} disabled={!isMcpServerFormValid(value) || busy}>
            {server ? tCommon('save') : t('add')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

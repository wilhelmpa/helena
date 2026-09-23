import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry, CredentialKind } from '@/lib/api/endpoints/credentials';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useCreateCredential, useUpdateCredential } from '@/services/credentials.service';
import {
  credentialValue,
  emptyCredentialValue,
  isCredentialFormValid,
  toCredentialPatch,
  toNewCredential,
  type CredentialFormValue,
} from '../../utils/credentialForm';
import { CredentialFields } from './CredentialFields';

// Adds a credential of one kind, or edits one. An SSH key is generated when it is saved,
// so the dialog then stays open on its public key.
export function CredentialDialog({
  teamId,
  kind,
  entry,
  onClose,
}: {
  teamId: number;
  kind: CredentialKind;
  entry: CredentialEntry | null;
  onClose: () => void;
}) {
  const t = useTranslations('credentials');
  const tCommon = useTranslations('common');
  const [current, setCurrent] = useState(entry);
  const [value, setValue] = useState<CredentialFormValue>(() =>
    entry ? credentialValue(entry) : emptyCredentialValue(kind),
  );
  const create = useCreateCredential(teamId);
  const update = useUpdateCredential(teamId);
  const busy = create.isPending || update.isPending;
  const valid = isCredentialFormValid(value, current);

  function show(saved: CredentialEntry) {
    setCurrent(saved);
    setValue(credentialValue(saved));
  }

  async function submit() {
    if (!valid || busy) return;
    try {
      if (current) {
        await update.mutateAsync({ id: current.id, input: toCredentialPatch(value) });
        onClose();
        return;
      }
      const created = await create.mutateAsync(toNewCredential(value));
      if (created.kind === 'ssh_key') show(created);
      else onClose();
    } catch {
      // The failure is toasted; the dialog stays open with what was entered.
    }
  }

  return (
    <Modal title={current ? t('edit') : t(`new.${kind}`)} onClose={onClose} wide>
      <form
        className="space-y-5"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CredentialFields
          teamId={teamId}
          value={value}
          entry={current}
          onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
          onKeyChange={show}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {current && !entry ? tCommon('close') : tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {current ? tCommon('save') : t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

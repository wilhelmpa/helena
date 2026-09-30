'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Inline, Notice, Segmented, Stack, TextField } from '@/design-system';
import Modal from '@/components/common/overlay/Modal';
import type { CatalogSourceKind } from '@/lib/api/endpoints/catalog';
import { useAddCatalogSource, useRefreshCatalogSource } from '@/services/catalog.service';
import CatalogError from './CatalogError';

const KINDS: CatalogSourceKind[] = ['github-skills', 'npm-mcp', 'pypi-mcp', 'github-mcp'];

// A curated source is one GitHub repository or one package — never a search across the
// web. Adding it also reads its entries once; if that fails the source stays and the
// dialog says so.
export default function AddSourceDialog({
  teamId,
  teamName,
  onClose,
}: {
  teamId: number;
  teamName: string;
  onClose: () => void;
}) {
  const t = useTranslations('catalog.sources.add');
  const tCommon = useTranslations('common');
  const [kind, setKind] = useState<CatalogSourceKind>('github-skills');
  const [locator, setLocator] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const add = useAddCatalogSource(teamId);
  const refresh = useRefreshCatalogSource(teamId);
  const busy = add.isPending || refresh.isPending;

  async function submit() {
    setError(null);
    try {
      const source = await add.mutateAsync({
        kind,
        locator: locator.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
      });
      setAdded(true);
      await refresh.mutateAsync(source.id);
      onClose();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <Modal
      title={t('title')}
      scope={teamName}
      onClose={onClose}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        field.current?.focus();
      }}
    >
      <Stack gap={4}>
        <Segmented<CatalogSourceKind>
          label={t('kind')}
          value={kind}
          onChange={setKind}
          options={KINDS.map((value) => ({ value, label: t(`kinds.${value}`) }))}
        />
        <Field label={t('locator')} hint={t(`hints.${kind}`)} htmlFor="catalog-source-locator">
          <TextField
            id="catalog-source-locator"
            ref={field}
            value={locator}
            placeholder={t(`placeholders.${kind}`)}
            onChange={(event) => setLocator(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && locator.trim() && !busy && !added) void submit();
            }}
          />
        </Field>
        <Field label={t('role')} hint={t('roleHint')} htmlFor="catalog-source-role">
          <TextField
            id="catalog-source-role"
            value={role}
            placeholder={t('rolePlaceholder')}
            onChange={(event) => setRole(event.target.value)}
          />
        </Field>
        {added && error != null && (
          <Notice tone="warning" title={t('addedNoEntries.title')}>
            {t('addedNoEntries.text')}
          </Notice>
        )}
        <CatalogError error={error} />
        <Inline gap={2} justify="end">
          <Button onClick={onClose} disabled={busy}>
            {added ? tCommon('close') : tCommon('cancel')}
          </Button>
          {!added && (
            <Button
              variant="primary"
              disabled={busy || !locator.trim()}
              onClick={() => void submit()}
            >
              {busy ? t('adding') : t('submit')}
            </Button>
          )}
        </Inline>
      </Stack>
    </Modal>
  );
}

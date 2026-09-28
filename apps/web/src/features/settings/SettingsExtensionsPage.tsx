'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import { toast } from 'sonner';
import { useShell } from '@/context/shellContext';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Switch } from '@/components/ui/switch';
import { EmptyState, Pill, SettingsGroup, SettingsRow, TextField } from '@/design-system';
import { ApiError } from '@/lib/api/core/client';
import type {
  ExtensionConnection,
  ExtensionField,
  ExtensionValue,
  ProjectExtension,
} from '@/lib/api/endpoints/plugins';
import { useProjectExtensionsQuery, useUpdateProjectExtension } from '@/services/plugins.service';
import { byKey } from '@/utils/messageKey';
import { credentialsPath } from '@/utils/paths';

// Projekt › Einstellungen › Erweiterungen: the settings a plugin brings for this project,
// built from its connectors' fields (a plugin says what can be set; nothing here names a
// plugin). One group per connection: its limits, lists and switches as settings rows, saved
// on their own (a switch at once, a field when it is left); a secret only says whether it is
// set, and changes in Zugänge.
export default function SettingsExtensionsPage() {
  const { project } = useShell();
  const t = useTranslations('settings.extensions');
  if (!project) return null;
  return (
    <SectionPageView title={t('title')}>
      <ExtensionsBody projectKey={project.project.key} />
    </SectionPageView>
  );
}

function ExtensionsBody({ projectKey }: { projectKey: string }) {
  const t = useTranslations('settings.extensions');
  const query = useProjectExtensionsQuery(projectKey);
  if (query.isPending) return <ListSkeleton rows={4} rowClassName="h-14" />;
  if (query.error)
    return (
      <EmptyState>
        {query.error instanceof ApiError && query.error.status === 403
          ? t('adminOnly')
          : t('loadFailed')}
      </EmptyState>
    );
  if (query.data.length === 0) return <EmptyState>{t('none')}</EmptyState>;
  return (
    <div className="ds-stack">
      {query.data.flatMap((extension) =>
        extension.connectors.flatMap((connector) =>
          connector.connections.map((connection) => (
            <ConnectionGroup
              key={connection.id}
              projectKey={projectKey}
              extension={extension}
              connector={connector}
              connection={connection}
            />
          )),
        ),
      )}
    </div>
  );
}

function ConnectionGroup({
  projectKey,
  extension,
  connector,
  connection,
}: {
  projectKey: string;
  extension: ProjectExtension;
  connector: ProjectExtension['connectors'][number];
  connection: ExtensionConnection;
}) {
  const t = useTranslations('settings.extensions');
  const tAny = byKey(useTranslations());
  const locale = useLocale();
  const text = (value: Parameters<typeof resolveText>[0]) =>
    resolveText(value, locale, (key) => tAny(key));
  const update = useUpdateProjectExtension(projectKey);

  async function save(field: ExtensionField, value: ExtensionValue) {
    try {
      await update.mutateAsync({ credentialId: connection.id, values: { [field.key]: value } });
      toast.success(t('saved', { name: text(field.label) }));
    } catch {
      // The global mutation handler shows the API's message.
    }
  }

  const settings = connector.fields.filter((field) => field.type !== 'secret');
  const secrets = connector.fields.filter((field) => field.type === 'secret');
  const title = connection.label
    ? `${text(connector.label)} · ${connection.label}`
    : text(connector.label);
  return (
    <SettingsGroup
      title={title}
      description={t('from', { name: text(extension.name), version: extension.version })}
    >
      {settings.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          label={text(field.label)}
          help={field.help ? text(field.help) : undefined}
          value={connection.values[field.key]}
          busy={update.isPending}
          onSave={(value) => save(field, value)}
        />
      ))}
      {secrets.map((field) => (
        <SettingsRow
          key={field.key}
          label={text(field.label)}
          description={
            <>
              {t('secretHint')}{' '}
              <Link className="ds-link" href={credentialsPath()}>
                {t('toAccess')}
              </Link>
            </>
          }
        >
          <Pill tone={connection.secrets[field.key] ? 'success' : 'warning'}>
            {connection.secrets[field.key] ? t('secretSet') : t('secretMissing')}
          </Pill>
        </SettingsRow>
      ))}
    </SettingsGroup>
  );
}

function FieldRow({
  field,
  label,
  help,
  value,
  busy,
  onSave,
}: {
  field: ExtensionField;
  label: string;
  help?: string;
  value: ExtensionValue | undefined;
  busy: boolean;
  onSave: (value: ExtensionValue) => void;
}) {
  const t = useTranslations('settings.extensions');
  const id = `extension-${field.key}`;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (field.type === 'boolean') {
    return (
      <SettingsRow label={label} description={help} htmlFor={id}>
        <Switch
          id={id}
          checked={value === true}
          disabled={busy}
          onCheckedChange={(checked) => onSave(checked)}
        />
      </SettingsRow>
    );
  }

  const shown = draft ?? (value === undefined ? '' : String(value));
  function commit() {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === (value === undefined ? '' : String(value))) {
      setDraft(null);
      return;
    }
    if (field.type === 'number') {
      const number = Number(trimmed.replace(',', '.'));
      if (trimmed === '' ? field.required : Number.isNaN(number)) {
        setError(field.required && trimmed === '' ? t('required') : t('number'));
        return;
      }
      setError(null);
      setDraft(null);
      onSave(trimmed === '' ? '' : number);
      return;
    }
    if (field.required && trimmed === '') {
      setError(t('required'));
      return;
    }
    setError(null);
    setDraft(null);
    onSave(trimmed);
  }

  return (
    <SettingsRow
      label={label}
      description={
        error ? (
          <span className="ds-field-error" role="alert">
            {error}
          </span>
        ) : (
          help
        )
      }
      htmlFor={id}
    >
      <TextField
        id={id}
        className="ds-extension-field"
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={shown}
        placeholder={field.placeholder ?? undefined}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(null);
            setError(null);
          }
        }}
      />
    </SettingsRow>
  );
}

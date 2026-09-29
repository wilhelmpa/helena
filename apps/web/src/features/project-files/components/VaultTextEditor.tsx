import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { readFileText, saveFileText, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { filesScopeKey } from '@/services/files.service';
import VaultMarkdownContent from './VaultMarkdownContent';

export default function VaultTextEditor({
  scope,
  path,
  canEdit,
  onDirty,
  vaultPath,
  beforeNavigate,
  sourceOnly = false,
}: {
  scope: FileScope;
  path: string;
  canEdit: boolean;
  onDirty: (dirty: boolean) => void;
  vaultPath?: string;
  beforeNavigate: () => boolean;
  sourceOnly?: boolean;
}) {
  const t = useTranslations('files.unified');
  const client = useQueryClient();
  const queryKey = [...filesScopeKey(scope), 'text', path];
  const query = useQuery({ queryKey, queryFn: () => readFileText(scope, path), retry: false });
  const [draft, setDraft] = useState<{
    content: string;
    etag: string;
    originalContent: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== null && draft.content !== draft.originalContent;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = async () => {
    if (!draft || !dirty || !canEdit || saving) return;
    setSaving(true);
    try {
      const written = await saveFileText(scope, path, draft.content, draft.etag);
      client.setQueryData(queryKey, written);
      setDraft(null);
      await client.invalidateQueries({ queryKey: filesScopeKey(scope) });
      toast.success(t('saved'));
    } catch {
      toast.error(t('conflict'));
    } finally {
      setSaving(false);
    }
  };
  if (query.isPending) return <p role="status">{t('loading')}</p>;
  if (!query.data) return <p role="alert">{t('readError')}</p>;
  const currentFile = query.data;
  const edit = (content: string) => {
    if (!canEdit || saving) return;
    setDraft((current) => {
      const originalContent = current?.originalContent ?? currentFile.content;
      return !current && content === originalContent
        ? null
        : {
            content,
            etag: current?.etag ?? currentFile.etag,
            originalContent,
          };
    });
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      role="group"
      aria-label={t('content')}
      onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{dirty ? t('unsaved') : sourceOnly ? '' : t('original')}</span>
        {canEdit && (
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {t('save')}
          </Button>
        )}
      </div>
      {vaultPath && /\.(md|markdown|txt)$/i.test(path) ? (
        <VaultMarkdownContent
          key={`${draft?.etag ?? query.data.etag}:${sourceOnly ? 'source' : 'formatted'}`}
          content={draft?.originalContent ?? query.data.content}
          value={draft?.content ?? query.data.content}
          vaultPath={vaultPath}
          editable={canEdit && !saving}
          onChange={edit}
          beforeNavigate={beforeNavigate}
          sourceOnly={sourceOnly}
        />
      ) : (
        <Textarea
          aria-label={t('content')}
          className="min-h-[55vh] flex-1 resize-none font-mono"
          value={draft?.content ?? query.data.content}
          readOnly={!canEdit || saving}
          onChange={(event) => edit(event.target.value)}
        />
      )}
    </div>
  );
}

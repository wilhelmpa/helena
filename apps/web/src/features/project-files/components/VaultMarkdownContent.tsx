import { useTranslations } from 'next-intl';
import DocumentMarkdownEditor from '@/components/common/editor/DocumentMarkdownEditor';
import { useVaultWikilinkOpener } from '@/hooks/useVaultWikilinkOpener';
import { Button } from '@/components/ui/button';
import { useVaultMarkdownSession } from '../hooks/useVaultMarkdownSession';
import VaultMarkdownBoundary from './VaultMarkdownBoundary';
import VaultMarkdownSource from './VaultMarkdownSource';

export default function VaultMarkdownContent({
  content,
  value,
  vaultPath,
  editable,
  onChange,
  beforeNavigate,
}: {
  content: string;
  value: string;
  vaultPath: string;
  editable: boolean;
  onChange: (content: string) => void;
  beforeNavigate: () => boolean;
}) {
  const t = useTranslations('documents');
  const files = useTranslations('files.unified');
  const session = useVaultMarkdownSession({ content, value, vaultPath, editable, onChange });
  const { mode, lossless } = session;
  const openWikilink = useVaultWikilinkOpener(vaultPath, { beforeNavigate });
  const sourceEditor = (
    <VaultMarkdownSource value={value} editable={editable} onChange={onChange} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex gap-2" role="group" aria-label={files('editor')}>
        <Button
          size="sm"
          variant={mode === 'formatted' ? 'default' : 'outline'}
          aria-pressed={mode === 'formatted'}
          onClick={session.showFormatted}
        >
          {files('formatted')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'source' ? 'default' : 'outline'}
          aria-pressed={mode === 'source'}
          onClick={session.showSource}
        >
          {files('source')}
        </Button>
      </div>
      {lossless === false && (
        <p role="status" className="text-sm text-muted-foreground">
          {files('sourceRequired')}
        </p>
      )}
      {mode === 'source' ? (
        sourceEditor
      ) : (
        <VaultMarkdownBoundary
          key={session.revision}
          fallback={sourceEditor}
          onError={session.failClosed}
        >
          <DocumentMarkdownEditor
            defaultValue={session.markdown}
            editable={editable && lossless === true}
            placeholder={t('contentPlaceholder')}
            className="min-h-[55vh] flex-1 text-base leading-7"
            onReady={session.onReady}
            onChange={session.onChange}
            onBlur={() => {}}
            onOpenWikilink={(inner) => void openWikilink(inner)}
          />
        </VaultMarkdownBoundary>
      )}
    </div>
  );
}

import { useTranslations } from 'next-intl';
import DocumentMarkdownEditor from '@/components/common/editor/DocumentMarkdownEditor';
import { useVaultWikilinkOpener } from '@/hooks/useVaultWikilinkOpener';
import { Segmented } from '@/design-system';
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
  sourceOnly = false,
}: {
  content: string;
  value: string;
  vaultPath: string;
  editable: boolean;
  onChange: (content: string) => void;
  beforeNavigate: () => boolean;
  sourceOnly?: boolean;
}) {
  const t = useTranslations('documents');
  const files = useTranslations('files.unified');
  const session = useVaultMarkdownSession({
    content,
    value,
    vaultPath,
    editable,
    onChange,
    initialMode: sourceOnly ? 'source' : 'formatted',
  });
  const { mode, lossless } = session;
  const openWikilink = useVaultWikilinkOpener(vaultPath, { beforeNavigate });
  const sourceEditor = (
    <VaultMarkdownSource value={value} editable={editable} onChange={onChange} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {!sourceOnly && (
        <Segmented
          className="self-start"
          label={files('editor')}
          value={mode}
          onChange={(next) => (next === 'source' ? session.showSource() : session.showFormatted())}
          options={[
            { value: 'formatted', label: files('formatted') },
            { value: 'source', label: files('source') },
          ]}
        />
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

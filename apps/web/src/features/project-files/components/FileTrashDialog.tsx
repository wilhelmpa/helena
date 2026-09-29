import { useQuery } from '@tanstack/react-query';
import { File, Folder } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button, Inline, List, ListRow, Stack, Text } from '@/design-system';
import { listFiles, type FileItem, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { useTrashFile } from '../services/projectFiles.service';

const SHOWN = 8;

// "In den Papierkorb": a file goes after one question; a folder shows what it holds first
// (Auftrag 117), so nothing goes by surprise. Both can be restored from the Papierkorb.
export default function FileTrashDialog({
  scope,
  item,
  onClose,
}: {
  scope: FileScope;
  item: FileItem;
  onClose: () => void;
}) {
  const t = useTranslations('files');
  const trash = useTrashFile(scope);
  const folder = item.kind === 'folder';
  const contents = useQuery({
    queryKey: ['file-trash-contents', scope, item.path],
    queryFn: () => listFiles(scope, item.path),
    enabled: folder,
  });
  const entries = contents.data?.items ?? [];
  return (
    <Modal
      title={t('trashDialog.title', { name: item.name })}
      description={t('trashDialog.description')}
      onClose={onClose}
    >
      <Stack gap={4}>
        {folder &&
          (contents.isPending ? (
            <Text size="sm" tone="muted">
              {t('trashDialog.counting')}
            </Text>
          ) : entries.length === 0 ? (
            <Text size="sm" tone="muted">
              {t('trashDialog.emptyFolder')}
            </Text>
          ) : (
            <Stack gap={2}>
              <Text size="sm">{t('trashDialog.folderHolds', { count: entries.length })}</Text>
              <List label={item.name}>
                {entries.slice(0, SHOWN).map((entry) => (
                  <ListRow
                    key={entry.path}
                    icon={entry.kind === 'folder' ? <Folder /> : <File />}
                    title={entry.name}
                  />
                ))}
              </List>
              {entries.length > SHOWN && (
                <Text size="xs" tone="muted">
                  {t('trashDialog.more', { count: entries.length - SHOWN })}
                </Text>
              )}
            </Stack>
          ))}
        <Inline gap={2} justify="end">
          <Button onClick={onClose}>{t('dialog.cancel')}</Button>
          <Button
            variant="danger"
            disabled={trash.isPending || (folder && contents.isPending)}
            onClick={() =>
              trash.mutate(item.path, {
                onSuccess: () => {
                  toast.success(t('trashed', { name: item.name }));
                  onClose();
                },
              })
            }
          >
            {t('trashDialog.confirm')}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}

'use client';

import { useState } from 'react';
import { EyeOff, File, FileCode, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Box, CodeBlock, EmptyState, List, ListRow, Pill, Stack, Text } from '@/design-system';
import Markdown from '@/components/common/Markdown';
import type { CatalogRevision } from '@/lib/api/endpoints/catalog';
import {
  decodeContent,
  formatBytes,
  isMarkdownFile,
  scriptPaths,
  withoutFrontMatter,
} from '../utils/catalog';

// Every file of the inspected version with its size; scripts are marked. A click opens the
// file: text as text, a markdown file formatted, one the inspection hid as a note.
export default function PreviewFiles({ revision }: { revision: CatalogRevision | null }) {
  const t = useTranslations('catalog.files');
  const [open, setOpen] = useState<string | null>(null);
  if (!revision)
    return (
      <EmptyState fill={false} icon={<File />}>
        {t('notInspected')}
      </EmptyState>
    );
  const scripts = scriptPaths(revision);
  const files = revision.manifest.files;
  if (files.length === 0)
    return (
      <EmptyState fill={false} icon={<File />}>
        {t('empty')}
      </EmptyState>
    );
  return (
    <Stack gap={3}>
      <Text size="xs" tone="muted">
        {t('summary', { count: files.length, scripts: scripts.size })}
      </Text>
      <List label={t('title')}>
        {files.map((file) => {
          const isScript = scripts.has(file.path);
          const selected = open === file.path;
          const content = selected ? decodeContent(file) : null;
          return (
            <div key={file.path}>
              <ListRow
                icon={isScript ? <FileCode /> : isMarkdownFile(file.path) ? <FileText /> : <File />}
                title={file.path}
                meta={
                  <>
                    {isScript && <Pill tone="warning">{t('script')}</Pill>}
                    {file.content === '' && <Pill tone="danger">{t('hidden')}</Pill>}
                    <span>{formatBytes(file.size)}</span>
                  </>
                }
                selected={selected}
                onSelect={() => setOpen(selected ? null : file.path)}
              />
              {selected &&
                (file.content === '' ? (
                  <Box padX={3} padY={2}>
                    <Text size="xs" tone="muted">
                      <EyeOff size={12} aria-hidden="true" /> {t('hiddenText')}
                    </Text>
                  </Box>
                ) : content == null ? (
                  <Box padX={3} padY={2}>
                    <Text size="xs" tone="muted">
                      {t('unreadable')}
                    </Text>
                  </Box>
                ) : isMarkdownFile(file.path) ? (
                  <div className="ds-skill-text">
                    <Markdown>{withoutFrontMatter(content)}</Markdown>
                  </div>
                ) : (
                  <CodeBlock label={file.path}>{content}</CodeBlock>
                ))}
            </div>
          );
        })}
      </List>
    </Stack>
  );
}

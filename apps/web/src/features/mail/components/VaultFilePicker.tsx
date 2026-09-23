'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft, File, Folder } from 'lucide-react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { listProjectFiles } from '@/lib/api/endpoints/projectFiles';
import { useProjectsQuery } from '@/services/projects.service';

// Browses a project's vault folder to attach one of its files.
export default function VaultFilePicker({
  teamId,
  onClose,
  onPick,
}: {
  teamId: number;
  onClose: () => void;
  onPick: (vaultPath: string) => void;
}) {
  const t = useTranslations('mail.compose');
  const projects = (useProjectsQuery().data ?? []).filter((item) => item.teamId === teamId);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const key = projectKey ?? projects[0]?.key ?? null;
  const listing = useQuery({
    queryKey: ['projectFiles', key, path],
    queryFn: () => listProjectFiles(key!, path),
    enabled: key != null,
  });

  return (
    <Modal title={t('vaultTitle')} description={t('vaultDescription')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {projects.map((project) => (
            <Button
              key={project.id}
              type="button"
              size="sm"
              variant={project.key === key ? 'secondary' : 'ghost'}
              onClick={() => {
                setProjectKey(project.key);
                setPath('');
              }}
            >
              {project.name}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {path && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={t('up')}
              onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
            >
              <ChevronLeft />
            </Button>
          )}
          <span className="truncate">{`Projects/${key ?? ''}/${path}`}</span>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {(listing.data?.items ?? []).map((item) => (
            <li key={item.path}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-start text-sm hover:bg-accent"
                onClick={() =>
                  item.kind === 'folder'
                    ? setPath(item.path)
                    : onPick(`Projects/${key}/${item.path}`)
                }
              >
                {item.kind === 'folder' ? (
                  <Folder className="size-4 text-muted-foreground" />
                ) : (
                  <File className="size-4 text-muted-foreground" />
                )}
                <span dir="auto" className="truncate">
                  {item.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {listing.isError && <p className="text-sm text-destructive">{t('vaultError')}</p>}
      </div>
    </Modal>
  );
}

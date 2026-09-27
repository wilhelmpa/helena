'use client';
/* eslint-disable no-restricted-syntax -- Baumfarben folgen dem freigegebenen Wissen-Entwurf. */

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import { useFilesQuery } from '@/services/files.service';

function TreeFolder({
  scope,
  folder,
  depth,
  expanded,
  toggle,
  active,
  onNavigate,
  onSelect,
}: {
  scope: FileScope;
  folder: string;
  depth: number;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
  active: string;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const open = expanded.has(folder);
  const listing = useFilesQuery(scope, folder, open);
  const name = folder.split('/').at(-1) || 'Wissen';
  return (
    <li>
      <div
        className={`flex items-center rounded-lg ${active === folder ? 'bg-[#26212d] text-[#eeeaf6]' : 'text-[#a9a1b2]'}`}
        style={{ paddingInlineStart: depth * 12 }}
      >
        <button
          type="button"
          aria-label={`${open ? 'Schließen' : 'Öffnen'}: ${name}`}
          onClick={() => toggle(folder)}
          className="grid size-7 shrink-0 place-items-center"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(folder)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-start text-xs"
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open && (
        <ul role="group" className="space-y-0.5">
          {listing.data?.items.map((item: FileItem) =>
            item.kind === 'folder' ? (
              <TreeFolder
                key={item.path}
                scope={scope}
                folder={item.path}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                active={active}
                onNavigate={onNavigate}
                onSelect={onSelect}
              />
            ) : (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => onSelect(item.path)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg py-2 pe-2 text-start text-xs text-[#a9a1b2] hover:bg-[#26212d]"
                  style={{ paddingInlineStart: (depth + 1) * 12 + 27 }}
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{item.name}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </li>
  );
}

export default function ProjectFolderTree({
  scope,
  path,
  onNavigate,
  onSelect,
}: {
  scope: FileScope;
  path: string;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const root = path.split('/')[0];
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(root ? [root] : []));
  const openFolders = new Set(expanded);
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++)
    openFolders.add(parts.slice(0, index).join('/'));
  if (!root) return null;
  const toggle = (folder: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  return (
    <aside
      className="w-52 shrink-0 overflow-y-auto border-e border-[#ffffff0a] pe-3 max-md:hidden"
      aria-label="Ordnerbaum"
    >
      <ul role="tree" className="space-y-0.5">
        <TreeFolder
          scope={scope}
          folder={root}
          depth={0}
          expanded={openFolders}
          toggle={toggle}
          active={path}
          onNavigate={onNavigate}
          onSelect={onSelect}
        />
      </ul>
    </aside>
  );
}

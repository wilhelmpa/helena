'use client';

import Link from 'next/link';
import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { vaultNotePath } from '@/utils/paths';
import type { VaultTreeNode } from '../utils/vaultTree';
import type { DocumentTreeAction } from './DocumentTreeDialog';
import DocumentTreeRowMenu from './DocumentTreeRowMenu';

export default function DocumentTreeRow({
  node,
  depth,
  openPath,
  expanded,
  canEdit,
  onToggle,
  onNewNote,
  onAction,
}: {
  node: VaultTreeNode;
  depth: number;
  openPath: string | null;
  expanded: ReadonlySet<string>;
  canEdit: boolean;
  onToggle: (folder: string) => void;
  onNewNote: (folder: string) => void;
  onAction: (action: DocumentTreeAction) => void;
}) {
  const { item, children } = node;
  const folder = item.kind === 'folder';
  const open = folder && expanded.has(item.path);
  const active = item.path === openPath;
  const label = (
    <span className="min-w-0 flex-1 truncate" dir="auto">
      {item.title}
    </span>
  );

  return (
    <li role="treeitem" aria-expanded={folder ? open : undefined} aria-selected={active}>
      <div
        className={cn(
          'group/row flex h-8 items-center rounded-md pe-1 text-sm transition-colors',
          active
            ? 'bg-accent font-medium text-accent-foreground'
            : 'focus-within:bg-muted/65 hover:bg-muted/65',
        )}
        style={{ paddingInlineStart: `${4 + Math.min(depth, 10) * 14}px` }}
      >
        {folder ? (
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            onClick={() => onToggle(item.path)}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform rtl:rotate-180',
                open && 'rotate-90 rtl:rotate-90',
              )}
            />
            {open ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {label}
          </button>
        ) : (
          <Link
            href={vaultNotePath(item.path)}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm ps-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-current={active ? 'page' : undefined}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            {label}
          </Link>
        )}
        {canEdit && <DocumentTreeRowMenu item={item} onNewNote={onNewNote} onAction={onAction} />}
      </div>
      {open && children.length > 0 && (
        <ul role="group" className="space-y-px">
          {children.map((child) => (
            <DocumentTreeRow
              key={child.item.path}
              node={child}
              depth={depth + 1}
              openPath={openPath}
              expanded={expanded}
              canEdit={canEdit}
              onToggle={onToggle}
              onNewNote={onNewNote}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

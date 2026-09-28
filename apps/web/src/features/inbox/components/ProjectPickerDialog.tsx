'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Home } from 'lucide-react';
import Modal from '@/components/common/overlay/Modal';
import { Input } from '@/components/ui/input';
import type { Project } from '@/lib/api/endpoints/projects';
import { cn } from '@/lib/utils';

// Picks the project a thread is filed under (or Home) by typing and Enter.
export default function ProjectPickerDialog({
  title,
  description,
  projects,
  currentProjectId,
  allowHome,
  pending,
  onClose,
  onPick,
}: {
  title: string;
  description: string;
  projects: Pick<Project, 'id' | 'key' | 'name'>[];
  currentProjectId: number | null;
  allowHome: boolean;
  pending: boolean;
  onClose: () => void;
  onPick: (projectId: number | null) => void;
}) {
  const t = useTranslations('mail.move');
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const options = [
    ...(allowHome ? [{ id: null, key: '', name: t('home') }] : []),
    ...projects,
  ].filter(
    (option) =>
      !needle ||
      option.name.toLowerCase().includes(needle) ||
      option.key.toLowerCase().includes(needle),
  );

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Input
          autoFocus
          value={filter}
          placeholder={t('filter')}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && options[0] && !pending) onPick(options[0].id);
          }}
        />
        <ul className="max-h-72 overflow-y-auto">
          {options.map((option) => (
            <li key={option.id ?? 'home'}>
              <button
                type="button"
                disabled={pending}
                onClick={() => onPick(option.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent',
                  option.id === currentProjectId && 'font-medium',
                )}
              >
                {option.id == null ? (
                  <Home className="size-4 text-muted-foreground" />
                ) : (
                  <span className="w-12 font-mono text-xs text-muted-foreground">{option.key}</span>
                )}
                <span className="flex-1 truncate">{option.name}</span>
                {option.id === currentProjectId && <Check className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

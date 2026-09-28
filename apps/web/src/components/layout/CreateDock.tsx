'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { aiAgentsPath, aiTeamPath, filesPath, notesPath } from '@/utils/paths';

export default function CreateDock({
  projectKey,
  onNewIssue,
}: {
  projectKey: string;
  onNewIssue: () => void;
}) {
  const router = useRouter();
  const options = [
    { label: 'Doc', href: `${filesPath(projectKey)}?create=doc` },
    { label: 'Leinwand', href: `${notesPath(projectKey)}&create=canvas` },
    { label: 'Zeitplan', href: `${aiTeamPath(projectKey, 'schedules')}?create=schedule` },
    { label: 'Agent', href: `${aiAgentsPath(projectKey)}?create=agent` },
  ];
  return (
    <div className="create-dock fixed inset-e-[92px] bottom-6 size-14 rounded-full">
      <button
        type="button"
        aria-label="Neue Aufgabe (C)"
        onClick={onNewIssue}
        className="size-full rounded-full"
      >
        {'+'}
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Weitere erstellen"
            className="create-dock-arrow absolute -inset-e-1 -bottom-1 flex size-6 items-center justify-center rounded-full"
          >
            <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-40 p-1">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => router.push(option.href)}
              className="flex h-9 w-full items-center rounded-md px-3 text-start text-sm hover:bg-accent"
            >
              {option.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

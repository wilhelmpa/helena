'use client';

import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectsQuery } from '@/services/projects.service';

const HOME = 'home';

// The project whose mail an account brings in, or Home.
export default function MailProjectSelect({
  teamId,
  value,
  onChange,
  label,
  allowHome = true,
}: {
  teamId: number;
  value: number | null;
  onChange: (projectId: number | null) => void;
  label?: string;
  allowHome?: boolean;
}) {
  const t = useTranslations('mail.accounts');
  const projects = (useProjectsQuery().data ?? []).filter((item) => item.teamId === teamId);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label ?? t('project')}</Label>
      <Select
        value={value == null ? (allowHome ? HOME : undefined) : String(value)}
        onValueChange={(next) => onChange(next === HOME ? null : Number(next))}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('chooseProject')} />
        </SelectTrigger>
        <SelectContent>
          {allowHome && <SelectItem value={HOME}>{t('home')}</SelectItem>}
          {projects.map((project) => (
            <SelectItem key={project.id} value={String(project.id)}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

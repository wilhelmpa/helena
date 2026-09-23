import { useTranslations } from 'next-intl';
import { useTeamProjectOptionsQuery } from '@/services/teams.service';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TEAM = 'team';

// Whether a credential serves the whole team or one of its projects.
export function CredentialScopeSelect({
  teamId,
  value,
  onChange,
}: {
  teamId: number;
  value: number | null;
  onChange: (projectId: number | null) => void;
}) {
  const t = useTranslations('credentials');
  const projects = useTeamProjectOptionsQuery(teamId).data ?? [];
  return (
    <div className="space-y-1.5">
      <Label>{t('scope')}</Label>
      <Select
        value={value === null ? TEAM : String(value)}
        onValueChange={(next) => onChange(next === TEAM ? null : Number(next))}
      >
        <SelectTrigger className="w-full" aria-label={t('scope')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TEAM}>{t('scopeTeam')}</SelectItem>
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

'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { listCredentials } from '@/lib/api/endpoints/credentials';

const TYPED = 'typed';

// The password of an account: typed here, it is stored as a secret of the Credentials
// page; or one of the team's secrets there is picked. A secret limited to another
// project is not offered.
export default function MailPasswordField({
  teamId,
  projectId,
  label,
  password,
  credentialId,
  storedLabel,
  onChange,
}: {
  teamId: number;
  projectId: number | null;
  label: string;
  password: string;
  credentialId: number | undefined;
  // The secret the account uses now, if any.
  storedLabel: string | null;
  onChange: (value: { password: string; credentialId: number | undefined }) => void;
}) {
  const t = useTranslations('mail.accounts');
  const secrets = useQuery({
    queryKey: ['credentials', teamId, 'secret', 'mail'],
    queryFn: () => listCredentials(teamId, { page: 1, pageSize: 100 }, 'secret'),
  });
  const options = (secrets.data?.items ?? []).filter(
    (item) => item.projectId == null || item.projectId === projectId,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="mail-password">{label}</Label>
      <Select
        value={credentialId == null ? TYPED : String(credentialId)}
        onValueChange={(value) =>
          onChange({
            password: '',
            credentialId: value === TYPED ? undefined : Number(value),
          })
        }
      >
        <SelectTrigger aria-label={t('passwordSource')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TYPED}>{t('typePassword')}</SelectItem>
          {options.map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {t('useSecret', { label: item.label })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {credentialId == null && (
        <Input
          id="mail-password"
          type="password"
          autoComplete="new-password"
          value={password}
          placeholder={storedLabel ? t('passwordKept', { label: storedLabel }) : undefined}
          onChange={(event) => onChange({ password: event.target.value, credentialId: undefined })}
        />
      )}
      <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
    </div>
  );
}

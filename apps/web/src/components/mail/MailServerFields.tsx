'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MailServerInput } from '@/lib/api/endpoints/mail';

// The IMAP and SMTP servers of a provider without a preset. TLS off means STARTTLS,
// which the connection then requires.
export default function MailServerFields({
  value,
  onChange,
}: {
  value: MailServerInput;
  onChange: (patch: Partial<MailServerInput>) => void;
}) {
  const t = useTranslations('mail.accounts');
  const server = (kind: 'imap' | 'smtp') => {
    const host = `${kind}Host` as const;
    const port = `${kind}Port` as const;
    const tls = `${kind}Tls` as const;
    return (
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`mail-${host}`}>{t(host)}</Label>
          <Input
            id={`mail-${host}`}
            value={value[host]}
            onChange={(event) => onChange({ [host]: event.target.value.trim() })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`mail-${port}`}>{t('port')}</Label>
          <Input
            id={`mail-${port}`}
            type="number"
            min={1}
            max={65535}
            value={value[port]}
            onChange={(event) => onChange({ [port]: Number(event.target.value) })}
          />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <Switch
            checked={value[tls]}
            onCheckedChange={(checked) => onChange({ [tls]: checked })}
          />
          {t('tls')}
        </label>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      {server('imap')}
      {server('smtp')}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-username">{t('username')}</Label>
        <Input
          id="mail-username"
          value={value.username}
          onChange={(event) => onChange({ username: event.target.value })}
        />
      </div>
    </div>
  );
}

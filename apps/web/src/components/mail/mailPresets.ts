import type { MailServerInput } from '@/lib/api/endpoints/mail';

// Server settings a provider publishes. Google accepts an app password over IMAP and
// SMTP once two-step verification is on; the user name is the address.
export const GOOGLE_PRESET: Omit<MailServerInput, 'username'> = {
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpTls: true,
};

export function isGooglePreset(input: Omit<MailServerInput, 'username'>): boolean {
  return (Object.keys(GOOGLE_PRESET) as (keyof typeof GOOGLE_PRESET)[]).every(
    (key) => input[key] === GOOGLE_PRESET[key],
  );
}

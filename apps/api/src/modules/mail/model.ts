import { t } from 'elysia';

// Schemas the mail features share.

export const MailAddress = t.Object({
  name: t.String({ maxLength: 200 }),
  address: t.String({ format: 'email', maxLength: 320 }),
});

export const MailAddressList = t.Array(MailAddress, { maxItems: 100 });

export const MailFolderRole = t.Union([
  t.Literal('inbox'),
  t.Literal('sent'),
  t.Literal('drafts'),
  t.Literal('archive'),
  t.Literal('trash'),
  t.Literal('junk'),
  t.Literal('all'),
]);

export const teamParams = t.Object({ teamId: t.Numeric() });

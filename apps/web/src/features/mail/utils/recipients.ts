import type { MailAddress } from '@/lib/api/endpoints/mail';

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// Reads what was typed or pasted into a recipient field: "a@x.de, Anna <b@y.de>".
// Returns the addresses it understood and the rest, left in the field to correct.
export function parseRecipients(input: string): { addresses: MailAddress[]; rest: string } {
  const addresses: MailAddress[] = [];
  const rest: string[] = [];
  for (const part of input.split(/[,;\n]/)) {
    const text = part.trim();
    if (!text) continue;
    const named = /^(.*?)\s*<([^>]+)>$/.exec(text);
    const address = (named ? named[2]! : text).trim().toLowerCase();
    const name = named ? named[1]!.replace(/^"|"$/g, '').trim() : '';
    if (ADDRESS.test(address)) addresses.push({ name, address });
    else rest.push(text);
  }
  return { addresses, rest: rest.join(', ') };
}

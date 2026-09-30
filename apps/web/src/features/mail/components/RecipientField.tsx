'use client';

import { FieldFrame, Card } from '@/design-system';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { MailAddress } from '@/lib/api/endpoints/mail';
import { useMailContacts } from '../services/drafts.service';
import { parseRecipients } from '../utils/recipients';

// Recipients as chips; typing suggests people the team exchanged mail with.
export default function RecipientField({
  teamId,
  label,
  value,
  onChange,
  disabled,
}: {
  teamId: number;
  label: string;
  value: MailAddress[];
  onChange: (value: MailAddress[]) => void;
  disabled: boolean;
}) {
  const t = useTranslations('mail.compose');
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 200);
  const contacts = useMailContacts(teamId, query);
  const known = new Set(value.map((item) => item.address));
  const suggestions = (contacts.data ?? []).filter((item) => !known.has(item.address));

  const add = (items: MailAddress[]) => {
    const fresh = items.filter((item) => !known.has(item.address));
    if (fresh.length > 0) onChange([...value, ...fresh]);
  };
  const commit = () => {
    const { addresses, rest } = parseRecipients(text);
    add(addresses);
    setText(rest);
  };

  return (
    <div className="relative flex items-start gap-2 text-sm">
      <span className="w-10 shrink-0 pt-1.5 text-muted-foreground">{label}</span>
      <FieldFrame className="flex-1">
        {value.map((item) => (
          <span
            key={item.address}
            className="flex items-center gap-1 rounded-sm bg-muted px-1.5 text-xs"
          >
            <span dir="auto" title={item.address}>
              {item.name || item.address}
            </span>
            {!disabled && (
              <button
                type="button"
                aria-label={t('removeRecipient', { address: item.address })}
                onClick={() => onChange(value.filter((other) => other.address !== item.address))}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={text}
            aria-label={label}
            className="min-w-24 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
                if (!text.trim()) return;
                event.preventDefault();
                commit();
              } else if (event.key === 'Backspace' && !text && value.length > 0) {
                onChange(value.slice(0, -1));
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text');
              if (!/[,;\n]/.test(pasted)) return;
              event.preventDefault();
              const { addresses, rest } = parseRecipients(`${text}${pasted}`);
              add(addresses);
              setText(rest);
            }}
          />
        )}
      </FieldFrame>
      {suggestions.length > 0 && text.trim().length >= 2 && (
        <Card
          as="ul"
          tone="popover"
          pad="list"
          gap={0}
          className="absolute inset-x-12 top-full z-20 mt-1"
        >
          {suggestions.map((item) => (
            <li key={item.address}>
              <button
                type="button"
                className="flex w-full flex-col items-start rounded-sm px-2 py-1 text-start hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  add([item]);
                  setText('');
                }}
              >
                <span dir="auto">{item.name || item.address}</span>
                {item.name && <span className="text-xs text-muted-foreground">{item.address}</span>}
              </button>
            </li>
          ))}
        </Card>
      )}
    </div>
  );
}

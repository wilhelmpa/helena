'use client';

import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { MailAccountStatus } from '@/lib/api/endpoints/connections';

interface Props {
  accounts: MailAccountStatus[];
  account: string;
  query: string;
  busy: boolean;
  statusLabels: Record<MailAccountStatus['status'], string>;
  searchLabel: string;
  searchPlaceholder: string;
  onAccountChange: (account: string) => void;
  onQueryChange: (query: string) => void;
  onSearch: (event: FormEvent) => void;
}

export default function MailToolbar({
  accounts,
  account,
  query,
  busy,
  statusLabels,
  searchLabel,
  searchPlaceholder,
  onAccountChange,
  onQueryChange,
  onSearch,
}: Props) {
  const selected = accounts.find((item) => item.account === account);

  return (
    <form className="mb-5 flex min-w-0 flex-wrap gap-2" onSubmit={onSearch}>
      <label className="relative min-w-0">
        <span className="sr-only">{selected ? statusLabels[selected.status] : searchLabel}</span>
        <select
          className="h-9 max-w-64 rounded-md border bg-background py-1 ps-7 pe-8 text-sm"
          value={account}
          onChange={(event) => onAccountChange(event.target.value)}
        >
          {accounts.map((item) => (
            <option key={item.account} value={item.account} disabled={item.status !== 'connected'}>
              {item.account} · {statusLabels[item.status]}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className={`absolute top-1/2 left-2.5 size-2 -translate-y-1/2 rounded-full ${
            selected?.status === 'connected' ? 'bg-emerald-500' : 'bg-muted-foreground'
          }`}
        />
      </label>
      <input
        className="h-9 min-w-48 flex-1 rounded-md border bg-background px-3 text-sm"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={searchPlaceholder}
      />
      <Button className="h-9" disabled={busy || !account}>
        {searchLabel}
      </Button>
    </form>
  );
}

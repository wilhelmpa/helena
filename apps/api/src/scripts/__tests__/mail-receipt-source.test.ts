import { expect, it } from 'bun:test';
import type { ImapClient } from '../../../../worker/src/mail/transport';
import { fetchReceiptHistorySource } from '../mail-receipt-source';

function fixture() {
  const scope = { folder: 'Archive', uidValidity: '7' };
  const calls: unknown[][] = [];
  const client = {
    mailbox: { path: 'Archive', uidValidity: 7n },
    fetchAll: async (
      ...args: unknown[]
    ): Promise<
      {
        uid: number;
        size?: number;
        source?: Buffer;
        flags?: Set<string>;
      }[]
    > => {
      calls.push(args);
      return calls.length === 1
        ? [{ uid: 42, size: 4 }]
        : [{ uid: 42, source: Buffer.from('mail'), flags: new Set(['\\Seen']) }];
    },
  };
  const fetch = (remaining = 100) =>
    fetchReceiptHistorySource(client as unknown as ImapClient, scope, 42, remaining, 25);
  return { client, scope, calls, fetch };
}

it('bounds the provider fetch and preserves exact source bytes and flags', async () => {
  const { fetch, calls } = fixture();
  const source = await fetch(12);
  expect(source?.source).toEqual(Buffer.from('mail'));
  expect(source?.flags).toEqual(new Set(['\\Seen']));
  expect(calls[1]).toEqual([
    '42',
    { uid: true, source: { maxLength: 13 }, flags: true, internalDate: true },
    { uid: true },
  ]);
});

it('reports an unavailable or over-budget original without fetching bytes', async () => {
  for (const size of [undefined, 0, -1, 4.5, 26, Number.NaN]) {
    const { client, fetch } = fixture();
    let calls = 0;
    client.fetchAll = async () => {
      calls++;
      return [{ uid: 42, size }];
    };
    expect(await fetch()).toBeNull();
    expect(calls).toBe(1);
  }
  const { fetch, calls } = fixture();
  expect(await fetch(3)).toBeNull();
  expect(calls).toHaveLength(1);
});

it('rejects a different UID or multiple provider rows', async () => {
  for (const stage of [1, 2]) {
    for (const multiple of [false, true]) {
      const { client, fetch } = fixture();
      const original = client.fetchAll;
      let count = 0;
      client.fetchAll = async (...args) => {
        const rows = await original(...args);
        return ++count !== stage
          ? rows
          : multiple
            ? [...rows, ...rows]
            : rows.map((row) => ({ ...row, uid: 43 }));
      };
      await expect(fetch()).rejects.toThrow(stage === 1 ? 'different UID' : 'source unavailable');
    }
  }
});

it('rejects folder or UIDVALIDITY changes before or during fetch', async () => {
  for (const stage of [0, 1, 2]) {
    for (const key of ['folder', 'validity']) {
      const { client, fetch, calls } = fixture();
      const change = () =>
        key === 'folder' ? (client.mailbox.path = 'Other') : client.mailbox.uidValidity++;
      const original = client.fetchAll;
      if (stage === 0) change();
      client.fetchAll = async (...args) => {
        const rows = await original(...args);
        if (calls.length === stage) change();
        return rows;
      };
      await expect(fetch()).rejects.toThrow('folder or UID validity changed');
      expect(calls.length).toBe(stage);
    }
  }
});

it('rejects truncated, expanded and missing raw sources', async () => {
  for (const bytes of [undefined, Buffer.from('ma'), Buffer.alloc(26)]) {
    const { client, fetch } = fixture();
    let count = 0;
    client.fetchAll = async () =>
      ++count === 1 ? [{ uid: 42, size: 4 }] : [{ uid: 42, source: bytes }];
    await expect(fetch()).rejects.toThrow('source unavailable or exceeds limits');
  }
});

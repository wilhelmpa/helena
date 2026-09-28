import type { DBAdapter } from 'better-auth';

const WRITE_INTERVAL_MS = 60_000;

export function throttleApiKeyWrites(adapter: DBAdapter): DBAdapter {
  const recent = new Map<string, { row: Record<string, unknown>; writtenAt: number }>();

  return {
    ...adapter,
    async findOne<T>(args: Parameters<DBAdapter['findOne']>[0]): Promise<T | null> {
      const row = await adapter.findOne<T>(args);
      const record = row as Record<string, unknown> | null;
      if (args.model === 'apikey' && record && typeof record.id === 'string') {
        const previous = recent.get(record.id);
        const storedAt = record.lastRequest instanceof Date ? record.lastRequest.getTime() : 0;
        recent.set(record.id, {
          row: record,
          writtenAt: Math.max(previous?.writtenAt ?? 0, storedAt),
        });
      }
      return row;
    },
    async update<T>(args: Parameters<DBAdapter['update']>[0]): Promise<T | null> {
      const fields = Object.keys(args.update);
      const timestampOnly =
        args.model === 'apikey' &&
        fields.length === 1 &&
        (fields[0] === 'lastRequest' || fields[0] === 'updatedAt');
      const id = args.where.find((part) => part.field === 'id')?.value;
      const current = typeof id === 'string' ? recent.get(id) : undefined;
      if (!timestampOnly || !current) return adapter.update<T>(args);

      const now = Date.now();
      if (now - current.writtenAt < WRITE_INTERVAL_MS) {
        current.row = { ...current.row, ...args.update };
        return current.row as T;
      }
      current.writtenAt = now;
      try {
        const updated = await adapter.update<T>(args);
        if (updated) current.row = updated as Record<string, unknown>;
        return updated;
      } catch (error) {
        current.writtenAt = 0;
        throw error;
      }
    },
  };
}

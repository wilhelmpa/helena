import type { HelperStatus } from './helper';

export interface AptFreshness {
  listsUpdatedAt: string | null;
  refreshedAt: string | null;
  refreshAttemptedAt: string | null;
  refreshError: string | null;
}

export function aptFreshness(inventory: Record<string, unknown>): AptFreshness | null {
  const apt = inventory.apt;
  if (!apt || typeof apt !== 'object') return null;
  const fields = apt as Record<string, unknown>;
  const date = (key: string) => {
    const value = fields[key];
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  };
  return {
    listsUpdatedAt: date('listsUpdatedAt'),
    refreshedAt: date('refreshedAt'),
    refreshAttemptedAt: date('refreshAttemptedAt'),
    refreshError:
      typeof fields.refreshError === 'string' ? fields.refreshError.slice(0, 500) : null,
  };
}

export async function readUpdateInventory(
  request: (
    action: string,
    payload: Record<string, unknown>,
    timeout: number,
  ) => Promise<HelperStatus>,
  refreshApt: boolean,
): Promise<Record<string, unknown>> {
  let refreshError: string | null = null;
  if (refreshApt) {
    try {
      const status = await request('apt-refresh', {}, 300_000);
      const freshness = aptFreshness(status.result ?? {});
      if (status.ok && freshness?.refreshedAt && !freshness.refreshError) return status.result!;
      refreshError = status.error ?? 'The update helper did not confirm fresh APT metadata';
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error);
    }
  }
  const status = await request('inventory', {}, 90_000);
  if (!status.ok) throw new Error(status.error ?? 'The inventory failed');
  const inventory = { ...status.result };
  if (refreshError) {
    inventory.apt = {
      ...(typeof inventory.apt === 'object' ? inventory.apt : {}),
      refreshError: refreshError.slice(0, 500),
    };
  }
  return inventory;
}

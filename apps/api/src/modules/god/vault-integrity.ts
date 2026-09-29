import { readFile } from 'node:fs/promises';

const REPORT = '/var/lib/volition/plan/vault-integrity.json';
const MAX_AGE_MS = 30 * 60_000;

export interface VaultIntegrity {
  state: 'ok' | 'down';
  checkedAt: string | null;
  findings: { code: string; path: string; detail: string }[];
}

export async function vaultIntegrity(): Promise<VaultIntegrity> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(process.env.VOLITION_VAULT_INTEGRITY_REPORT || REPORT, 'utf8'),
    );
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid report');
    const report = parsed as Record<string, unknown>;
    if (typeof report.checkedAt !== 'string' || !Array.isArray(report.findings)) {
      throw new Error('Invalid report');
    }
    const age = Date.now() - Date.parse(report.checkedAt);
    const stale = !Number.isFinite(age) || age > MAX_AGE_MS || age < -5 * 60_000;
    return {
      state: stale || report.state !== 'ok' ? 'down' : 'ok',
      checkedAt: report.checkedAt,
      findings: stale
        ? [
            {
              code: 'stale_report',
              path: 'Vault',
              detail: 'The last check is older than 30 minutes',
            },
          ]
        : report.findings.filter(
            (item): item is { code: string; path: string; detail: string } =>
              item &&
              typeof item.code === 'string' &&
              typeof item.path === 'string' &&
              typeof item.detail === 'string',
          ),
    };
  } catch {
    return {
      state: 'down',
      checkedAt: null,
      findings: [
        { code: 'missing_report', path: 'Vault', detail: 'No integrity report is available' },
      ],
    };
  }
}

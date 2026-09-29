export interface PriorityConfig {
  maxConcurrent: number;
  reservedInteractive: number;
  maxBackground: number;
  queueTimeoutMs: number;
  maxQueue: number;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  maxConcurrent: 4,
  reservedInteractive: 1,
  maxBackground: 2,
  queueTimeoutMs: 30_000,
  maxQueue: 64,
};

export function priorityProxyBaseUrl(baseUrl: string): string {
  return baseUrl.replace(
    /^http:\/\/(127\.0\.0\.1|localhost):873([13])(?=\/|$)/,
    (_, host: string, port: string) => `http://${host}:${port === '1' ? '8741' : '8743'}`,
  );
}

export function isLocalHalogenUrl(url: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|localhost):(?:873[13]|874[13])(?:\/|$)/.test(url);
}

export function normalizeHalogenPriority(value: unknown): PriorityConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const integer = (key: keyof PriorityConfig, min: number, max: number) => {
    const n = raw[key];
    return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
      ? n
      : DEFAULT_PRIORITY_CONFIG[key];
  };
  const maxConcurrent = integer('maxConcurrent', 2, 4);
  return {
    maxConcurrent,
    reservedInteractive: Math.min(integer('reservedInteractive', 1, 3), maxConcurrent - 1),
    maxBackground: Math.min(integer('maxBackground', 1, 2), maxConcurrent - 1),
    queueTimeoutMs: integer('queueTimeoutMs', 1_000, 120_000),
    maxQueue: integer('maxQueue', 1, 512),
  };
}

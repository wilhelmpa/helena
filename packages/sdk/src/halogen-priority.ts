export interface PriorityConfig {
  maxConcurrent: number;
  reservedInteractive: number;
  maxInteractive: number;
  maxRealtime: number;
  maxNormal: number;
  maxBackground: number;
  realtimeQueueMs: number;
  interactiveQueueMs: number;
  agingMs: number;
  healthProbeMs: number;
  healthTimeoutMs: number;
  upstreamIdleMs: number;
  voiceReplyMaxTokens: number;
  realtimeMaxTokens: number;
  queueTimeoutMs: number;
  maxQueue: number;
  maxQueuedInteractive: number;
  maxQueuedRealtime: number;
  maxQueuedNormal: number;
  maxQueuedBackground: number;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  maxConcurrent: 4,
  reservedInteractive: 1,
  maxInteractive: 4,
  maxRealtime: 2,
  maxNormal: 3,
  maxBackground: 2,
  realtimeQueueMs: 750,
  interactiveQueueMs: 5_000,
  agingMs: 15_000,
  healthProbeMs: 3_000,
  healthTimeoutMs: 2_000,
  upstreamIdleMs: 60_000,
  voiceReplyMaxTokens: 512,
  realtimeMaxTokens: 64,
  queueTimeoutMs: 30_000,
  maxQueue: 64,
  maxQueuedInteractive: 16,
  maxQueuedRealtime: 16,
  maxQueuedNormal: 32,
  maxQueuedBackground: 24,
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
  const maxQueue = integer('maxQueue', 1, 512);
  return {
    maxConcurrent,
    reservedInteractive: Math.min(integer('reservedInteractive', 1, 3), maxConcurrent - 1),
    maxInteractive: Math.min(integer('maxInteractive', 1, 4), maxConcurrent),
    maxRealtime: Math.min(integer('maxRealtime', 1, 4), maxConcurrent),
    maxNormal: Math.min(integer('maxNormal', 1, 4), maxConcurrent - 1),
    maxBackground: Math.min(integer('maxBackground', 1, 3), maxConcurrent - 1),
    realtimeQueueMs: integer('realtimeQueueMs', 100, 5_000),
    interactiveQueueMs: integer('interactiveQueueMs', 100, 30_000),
    agingMs: integer('agingMs', 1_000, 120_000),
    healthProbeMs: integer('healthProbeMs', 500, 30_000),
    healthTimeoutMs: integer('healthTimeoutMs', 250, 60_000),
    upstreamIdleMs: integer('upstreamIdleMs', 1_000, 120_000),
    voiceReplyMaxTokens: integer('voiceReplyMaxTokens', 32, 4_096),
    realtimeMaxTokens: integer('realtimeMaxTokens', 8, 512),
    queueTimeoutMs: integer('queueTimeoutMs', 1_000, 120_000),
    maxQueue,
    maxQueuedInteractive: Math.min(integer('maxQueuedInteractive', 1, 512), maxQueue),
    maxQueuedRealtime: Math.min(integer('maxQueuedRealtime', 1, 512), maxQueue),
    maxQueuedNormal: Math.min(integer('maxQueuedNormal', 1, 512), maxQueue),
    maxQueuedBackground: Math.min(integer('maxQueuedBackground', 1, 512), maxQueue),
  };
}

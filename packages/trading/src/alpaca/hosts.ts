import { mentionsLiveTradingHost } from '@helena/policy';

// Where Helena's paper tools may go, and nowhere else (docs/helena-decisions/trading.md §5).
// Alpaca separates paper from live trading by host: orders go to paper-api.alpaca.markets,
// market data to data.alpaca.markets (read only, shared by paper and live accounts). The
// live trading host api.alpaca.markets is never built, never allowed, and a key that is not
// a paper key is refused before any request.

export const PAPER_TRADING_URL = 'https://paper-api.alpaca.markets';
export const MARKET_DATA_URL = 'https://data.alpaca.markets';

export const PAPER_HOSTS: readonly string[] = ['paper-api.alpaca.markets', 'data.alpaca.markets'];

export class NotPaperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotPaperError';
  }
}

// Throws unless the URL is https on one of the paper hosts, on the default port.
export function assertPaperUrl(url: URL | string): URL {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (
    parsed.protocol !== 'https:' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !PAPER_HOSTS.includes(parsed.hostname) ||
    mentionsLiveTradingHost(parsed.hostname)
  ) {
    throw new NotPaperError(`Refused: ${parsed.hostname} is not Alpaca's paper API.`);
  }
  return parsed;
}

// Alpaca issues paper keys with the prefix PK and live keys with AK. A key sent to the wrong
// environment is refused there with 401 anyway; Helena refuses it before it leaves.
export function isPaperKeyId(keyId: unknown): keyId is string {
  return typeof keyId === 'string' && /^PK[A-Z0-9]{8,40}$/.test(keyId.trim());
}

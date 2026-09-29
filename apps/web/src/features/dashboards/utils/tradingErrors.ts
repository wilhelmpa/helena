import { ApiError } from '@/lib/api/core/client';

// The trading widgets' reasons, as words. The API names them in English (apps/api
// trading/widget-data.ts); the reader gets them in their language, and anything this list
// does not know becomes the plain "could not be loaded", never a raw server sentence.
export type TradingProblem =
  | { kind: 'selectConnection' }
  | { kind: 'noConnection' }
  | { kind: 'connectionUnavailable' }
  | { kind: 'notPaper' }
  | { kind: 'provider'; status: number | null }
  | { kind: 'ordersIncomplete' }
  | { kind: 'historyIncomplete' }
  | { kind: 'noAccess' }
  | { kind: 'generic' };

export function problemOfMessage(message: string): TradingProblem {
  if (/^Select a paper connection/i.test(message)) return { kind: 'selectConnection' };
  if (/^No paper connection is available/i.test(message)) return { kind: 'noConnection' };
  if (/paper connection (is )?unavailable/i.test(message)) return { kind: 'connectionUnavailable' };
  if (/Only a paper connection|is not Alpaca's paper API/i.test(message))
    return { kind: 'notPaper' };
  const http = /Alpaca paper API returned HTTP (\d+)/i.exec(message);
  if (http) return { kind: 'provider', status: Number(http[1]) };
  if (/order list is incomplete/i.test(message)) return { kind: 'ordersIncomplete' };
  if (/Incomplete portfolio history/i.test(message)) return { kind: 'historyIncomplete' };
  return { kind: 'generic' };
}

// A request that failed as a whole (no session, no right, server down).
export function problemOfRequest(error: unknown): TradingProblem {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return { kind: 'noAccess' };
    if (error.status >= 500) return { kind: 'provider', status: null };
  }
  return { kind: 'generic' };
}

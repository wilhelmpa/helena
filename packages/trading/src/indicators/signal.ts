import type { AlpacaBar } from '../alpaca/client';
import { indicatorSet } from './index';

export const STRATEGY = 'macd-rsi-atr v1';

export function checkSignal(bars: readonly AlpacaBar[], equity: number, riskPercent = 0.5) {
  if (!Number.isFinite(equity) || equity <= 0) throw new Error('Paper equity must be positive.');
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 5)
    throw new Error('Risk percent must be greater than 0 and at most 5.');
  if (bars.length < 50) throw new Error('At least 50 completed bars are required.');
  const indicators = indicatorSet(bars);
  const i = bars.length - 1;
  const entry = bars[i]!.c;
  const macd = indicators.macd.line[i]!;
  const signalLine = indicators.macd.signal[i]!;
  const previousMacd = indicators.macd.line[i - 1]!;
  const previousSignalLine = indicators.macd.signal[i - 1]!;
  const rsi = indicators.rsi14[i]!;
  const ema50 = indicators.ema50[i]!;
  const atr = indicators.atr14[i]!;
  const crossover = previousMacd <= previousSignalLine && macd > signalLine;
  const rsiOk = rsi < 70;
  const trendOk = entry > ema50;
  const validStop = atr > 0 && entry - 1.5 * atr > 0;
  const riskUsd = (equity * riskPercent) / 100;
  const stop = validStop ? entry - 1.5 * atr : null;
  const target = validStop ? entry + 3 * atr : null;
  const riskPerUnit = validStop ? entry - stop! : null;
  const quantity = validStop ? Math.floor((riskUsd / riskPerUnit!) * 1e6) / 1e6 : 0;
  const reasons = [
    crossover ? 'MACD kreuzt Signallinie von unten.' : 'Kein MACD-Kreuz von unten.',
    rsiOk ? 'RSI unter 70.' : 'RSI mindestens 70.',
    trendOk ? 'Schlusskurs über EMA(50).' : 'Schlusskurs nicht über EMA(50).',
    validStop ? 'ATR und Stopp gültig.' : 'ATR null oder Stopp nicht positiv.',
    quantity > 0
      ? 'Risikobudget ergibt positive Menge.'
      : 'Risikobudget ergibt keine handelbare Menge.',
  ];
  return {
    strategy: STRATEGY,
    side: 'long' as const,
    signal: crossover && rsiOk && trendOk && validStop && quantity > 0,
    barTime: bars[i]!.t,
    entry,
    macd,
    signalLine,
    previousMacd,
    previousSignalLine,
    rsi,
    ema50,
    atr,
    stop,
    target,
    equity,
    riskPercent,
    riskUsd,
    riskPerUnit,
    quantity,
    positionValueUsd: quantity * entry,
    plannedRiskUsd: validStop ? quantity * riskPerUnit! : 0,
    reasons,
  };
}

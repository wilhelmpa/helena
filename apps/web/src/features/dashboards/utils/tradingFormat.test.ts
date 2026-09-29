import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney, formatPercent, formatTradingTime, pnlTone, usage } from './tradingFormat';

describe('trading formats', () => {
  it('writes money in the reader’s locale', () => {
    assert.match(formatMoney(1234.5, 'USD', 'de'), /1\.234,50\s?\$/);
    assert.match(formatMoney(1234.5, 'USD', 'en'), /\$1,234\.50/);
    assert.match(formatMoney(-17.2, 'USD', 'en', { sign: true }), /-\$17\.20/);
    assert.match(formatMoney(15.44, 'USD', 'en', { sign: true }), /\+\$15\.44/);
    assert.match(formatMoney(0, 'USD', 'en', { sign: true }), /^\$0\.00$/);
  });

  it('does not fail on a currency it does not know', () => {
    assert.match(formatMoney(5, 'XXXX1', 'en'), /5\.00/);
  });

  it('signs percentages', () => {
    assert.match(formatPercent(1.5, 'de', { sign: true }), /\+1,50\s?%/);
    assert.match(formatPercent(-3.277, 'en', { sign: true }), /-3\.28 %/);
  });

  it('shows no time for a missing or broken one', () => {
    assert.equal(formatTradingTime(null, 'de'), '–');
    assert.equal(formatTradingTime('nope', 'de'), '–');
    assert.match(formatTradingTime('2026-09-30T10:05:00Z', 'en', 'date'), /09\/30/);
  });

  it('tones a result by its sign', () => {
    assert.equal(pnlTone(3), 'success');
    assert.equal(pnlTone(-3), 'danger');
    assert.equal(pnlTone(0), 'default');
    assert.equal(pnlTone(null), 'default');
  });

  it('measures the use of a limit and its thresholds', () => {
    assert.deepEqual(usage(50, 100), { ratio: 0.5, raw: 0.5, warned: false, reached: false });
    assert.equal(usage(80, 100).warned, true);
    const over = usage(150, 100);
    assert.equal(over.ratio, 1);
    assert.equal(over.reached, true);
    assert.equal(usage(-20, 100).ratio, 0);
    assert.equal(usage(10, 0).reached, false);
  });
});

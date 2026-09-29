import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import type {
  TradingAccountData,
  TradingDecisionsData,
  TradingOrdersData,
  TradingPositionData,
  TradingStrategiesData,
} from '@/lib/api/endpoints/trading';
import dashboardsDe from '../../../../../messages/de/dashboards.json';
import dashboardsEn from '../../../../../messages/en/dashboards.json';
import TradingAccount from './TradingAccount';
import TradingDecisions from './TradingDecisions';
import TradingOrders from './TradingOrders';
import TradingPositions from './TradingPositions';
import TradingProblem from './TradingProblem';
import TradingStrategies from './TradingStrategies';

const globals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;

function render(node: React.ReactNode, locale: 'en' | 'de' = 'en') {
  act(() =>
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={{ dashboards: locale === 'de' ? dashboardsDe : dashboardsEn }}
        timeZone="UTC"
      >
        {node}
      </NextIntlClientProvider>,
    ),
  );
}
const text = () => document.querySelector('#root')!.textContent ?? '';

beforeEach(async () => {
  saved = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
});
afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const limits = {
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 300,
  maxOpenPositions: 5,
  maxOrdersPerDay: 10,
  allowedSymbols: ['SPY'],
  allowCrypto: false,
  halted: false,
};
const account: TradingAccountData = {
  status: 'ACTIVE',
  currency: 'USD',
  equity: 100842.55,
  cash: 98800,
  buyingPower: 198000,
  dayPnlUsd: -120,
  dayPnlPct: -0.12,
  tradingHalted: false,
  brokerTradingBlocked: false,
  limits,
  missingLimits: [],
  ordersToday: 3,
};
const position = (over: Partial<TradingPositionData> = {}): TradingPositionData => ({
  symbol: 'SPY',
  qty: 2,
  entryPrice: 500,
  currentPrice: 510,
  unrealizedPnlUsd: 20,
  unrealizedPnlPct: 2,
  stopPrice: 490,
  stopOrderId: 's',
  strategy: 'orb-spy',
  strategyVersion: '1.0',
  approvalStatus: 'approved',
  ...over,
});

// Every button in a trading body is the reader's way to look, never to act: the order scope
// tabs and the account choice. Nothing here places, closes or cancels an order or changes the stop.
const forbidden =
  /(buy|sell|close|cancel|place|halt|resume|approve|kaufen|verkaufen|schlie|storn|freigeben|anhalten)/i;

describe('trading widgets: account', () => {
  it('shows the figures and how much of each limit is used', () => {
    render(<TradingAccount data={account} positions={[position()]} />);
    assert.match(text(), /Trading active/);
    assert.match(text(), /\$100,842\.55/);
    assert.match(text(), /-\$120\.00/);
    assert.match(text(), /\$120 of \$300/);
    assert.match(text(), /3 of 10/);
    assert.match(text(), /1 of 5/);
    assert.equal(document.querySelectorAll('[role="meter"]').length, 4);
  });

  it('says trading is halted, and why, when the owner stopped it', () => {
    render(
      <TradingAccount
        data={{ ...account, tradingHalted: true, limits: { ...limits, halted: true } }}
        positions={null}
      />,
    );
    assert.match(text(), /Trading halted/);
    assert.match(text(), /You blocked new entries/);
    assert.doesNotMatch(text(), /Trading active/);
  });

  it('names the broker block and an inactive account apart', () => {
    render(
      <TradingAccount
        data={{ ...account, tradingHalted: true, brokerTradingBlocked: true }}
        positions={null}
      />,
    );
    assert.match(text(), /broker has blocked trading/);
    render(
      <TradingAccount
        data={{ ...account, tradingHalted: true, status: 'ONBOARDING' }}
        positions={null}
      />,
    );
    assert.match(text(), /not active \(status ONBOARDING\)/);
  });

  it('warns about limits the connection lacks', () => {
    render(
      <TradingAccount
        data={{ ...account, missingLimits: ['dailyLossLimitUsd', 'maxOrderValueUsd'] }}
        positions={null}
      />,
    );
    assert.match(text(), /Limits missing/);
    assert.match(text(), /Daily loss, Order value/);
  });

  it('marks a limit that is used up', () => {
    render(<TradingAccount data={{ ...account, ordersToday: 12 }} positions={null} />);
    assert.equal(document.querySelectorAll('.ds-budget[data-tone="reached"]').length >= 1, true);
  });

  it('has no control that acts', () => {
    render(<TradingAccount data={{ ...account, tradingHalted: true }} positions={null} />);
    assert.equal(document.querySelectorAll('button').length, 0);
  });

  it('writes German with German number formats', () => {
    render(<TradingAccount data={account} positions={null} />, 'de');
    assert.match(text(), /100\.842,55/);
    assert.match(text(), /Handel aktiv/);
    assert.match(text(), /Limits und Verbrauch/);
  });
});

describe('trading widgets: positions', () => {
  it('marks a position that has no protective stop', () => {
    render(
      <TradingPositions
        currency="USD"
        data={[
          position(),
          position({ symbol: 'NVDA', stopPrice: null, strategy: null, approvalStatus: null }),
        ]}
      />,
    );
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    assert.equal((text().match(/No stop/g) ?? []).length, 1);
    assert.match(text(), /no strategy/);
    assert.match(text(), /Approved/);
  });

  it('says so when nothing is open', () => {
    render(<TradingPositions currency="USD" data={[]} />);
    assert.match(text(), /No open positions/);
    assert.equal(document.querySelector('table'), null);
  });
});

const order = (id: string, over = {}) => ({
  id,
  clientOrderId: id,
  symbol: 'QQQ',
  side: 'buy',
  status: 'new',
  type: 'limit',
  qty: 3,
  limitPrice: 441.1,
  stopPrice: null,
  submittedAt: '2026-09-30T10:00:00Z',
  strategy: 'mom-qqq',
  strategyVersion: '0.3',
  journalPath: null,
  ...over,
});
const orders: TradingOrdersData = {
  open: [order('a')],
  today: [
    order('a'),
    order('b', { status: 'filled', journalPath: 'Projects/TRADE/Docs/Journal/x.md' }),
  ],
  recent: [
    order('a'),
    order('b'),
    order('c', { status: 'canceled', type: 'weird', side: 'short' }),
  ],
};

describe('trading widgets: orders', () => {
  it('lists open orders first and counts each scope', () => {
    render(<TradingOrders data={orders} currency="USD" />);
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    assert.deepEqual(tabs, ['Open · 1', 'Today · 2', 'Latest · 3']);
  });

  it('switches scope, links the journal and keeps unknown words readable', () => {
    render(<TradingOrders data={orders} currency="USD" />);
    const tab = (name: RegExp) =>
      [...document.querySelectorAll('[role="tab"]')].find((entry) =>
        name.test(entry.textContent ?? ''),
      )!;
    act(() => tab(/Today/).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    assert.equal(document.querySelectorAll('a[href*="Journal"]').length, 1);
    act(() => tab(/Latest/).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(text(), /weird/);
    assert.match(text(), /short/);
  });

  it('shows an empty scope in words', () => {
    render(<TradingOrders data={{ open: [], today: [], recent: [] }} currency="USD" />);
    assert.match(text(), /No open orders/);
  });

  it('offers only the scope tabs, no way to act on an order', () => {
    render(<TradingOrders data={orders} currency="USD" />);
    for (const button of document.querySelectorAll('button'))
      assert.equal(button.getAttribute('role'), 'tab');
    for (const link of document.querySelectorAll('a'))
      assert.doesNotMatch(link.textContent ?? '', forbidden);
  });
});

describe('trading widgets: strategies', () => {
  const data: TradingStrategiesData = {
    items: [
      {
        path: 'Projects/TRADE/Docs/Strategien/orb-spy.md',
        id: 'orb-spy',
        version: '1.0',
        status: 'paper',
        backtest: 'Projects/TRADE/Docs/Backtests/orb.md',
        approval: {
          id: 1,
          status: 'approved',
          accountId: 'a',
          strategyId: 'orb-spy',
          version: '1.0',
          path: 'p',
          createdAt: '2026-09-28T10:00:00Z',
          decidedAt: '2026-09-29T10:00:00Z',
        },
      },
      {
        path: 'Projects/TRADE/Docs/Strategien/x.md',
        id: 'x',
        version: '0.1',
        status: 'entwurf',
        backtest: null,
        approval: null,
      },
    ],
    approvals: [
      {
        id: 2,
        status: 'pending',
        accountId: 'a',
        strategyId: 'gone',
        version: '2.0',
        path: 'p',
        createdAt: '2026-09-30T10:00:00Z',
        decidedAt: null,
      },
    ],
  };

  it('shows status, approval and backtest per strategy, and an approval whose note is gone', () => {
    render(<TradingStrategies data={data} />);
    assert.equal(document.querySelectorAll('tbody tr').length, 3);
    assert.match(text(), /Approved/);
    assert.match(text(), /Not approved/);
    assert.match(text(), /Approval pending/);
    assert.match(text(), /Note missing/);
    assert.match(text(), /Pending approvals: 1/);
    assert.match(text(), /Granted: 1/);
    assert.equal(document.querySelectorAll('a[href*="orb-spy"]').length, 1);
    assert.match(text(), /Open backtest/);
  });

  it('has an empty state', () => {
    render(<TradingStrategies data={{ items: [], approvals: [] }} />);
    assert.match(text(), /No strategy in the project knowledge/);
  });
});

describe('trading widgets: decisions', () => {
  const data: TradingDecisionsData = {
    vetos: 2,
    classes: [
      {
        classId: 'helena.trading.news',
        jev: { safe: 9, unsure: 2 },
        local: { safe: 4, unsure: 0 },
        other: { safe: 0, unsure: 0 },
        fallback: 1,
      },
      {
        classId: 'helena.trading.unknown',
        jev: { safe: 0, unsure: 0 },
        local: { safe: 0, unsure: 0 },
        other: { safe: 1, unsure: 0 },
        fallback: 0,
      },
    ],
  };

  it('splits each class by who answered', () => {
    render(<TradingDecisions data={data} />);
    assert.match(text(), /Sort news/);
    assert.match(text(), /9 sure/);
    assert.match(text(), /2 unsure/);
    assert.match(text(), /Vetoes: 2/);
    assert.match(text(), /Decisions: 16/);
    assert.match(text(), /helena\.trading\.unknown/);
  });

  it('is an empty state without any decision', () => {
    render(<TradingDecisions data={{ classes: data.classes, vetos: 0 }} />);
    render(<TradingDecisions data={{ classes: [], vetos: 0 }} />);
    assert.match(text(), /No decisions in this period/);
  });
});

describe('trading widgets: problems', () => {
  const props = {
    credentialId: undefined,
    onCredentialChange: () => {},
    onRetry: () => {},
    retrying: false,
  };

  it('words a provider outage and offers a retry', () => {
    let retried = 0;
    render(
      <TradingProblem
        {...props}
        problem={{ kind: 'provider', status: 503 }}
        onRetry={() => retried++}
      />,
    );
    assert.match(text(), /not answering \(HTTP 503\)/);
    const button = document.querySelector('button')!;
    act(() => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(retried, 1);
  });

  it('never shows a raw server sentence', () => {
    render(<TradingProblem {...props} problem={{ kind: 'generic' }} />);
    assert.match(text(), /could not be loaded/);
  });

  it('asks for the account when several exist and offers no retry for a missing one', () => {
    render(<TradingProblem {...props} problem={{ kind: 'noConnection' }} />);
    assert.match(text(), /Tools → Alpaca Paper/);
    assert.equal(document.querySelector('button'), null);
  });
});

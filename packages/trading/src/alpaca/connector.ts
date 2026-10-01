import type { Connector, ConnectorHealth, CredentialValues } from '@helena/sdk';
import { AlpacaPaperClient } from './client';
import { isPaperKeyId } from './hosts';
import { readKeys, readLimits } from './limits';
import { ALPACA_PAPER_CONNECTOR, alpacaPaperTools, type PaperToolDeps } from './tools';

// Alpaca's paper account as a Helena connector. The owner opens the paper account at
// Alpaca himself (email only, no funding) and stores its paper keys together with his hard
// limits under Werkzeuge → Alpaca Paper. An agent gets the tools only when the owner binds
// them to it (a configured tool), and never sees the keys: Helena calls Alpaca itself.

const usd = { en: 'USD', de: 'USD' };

export function alpacaPaperConnector(deps: PaperToolDeps = {}): Connector {
  return {
    id: ALPACA_PAPER_CONNECTOR,
    label: { en: 'Alpaca paper trading (demo money)', de: 'Alpaca Paper-Trading (Spielgeld)' },
    description: {
      en: 'An Alpaca paper account: simulated orders for US stocks, ETFs and crypto. Paper keys only (they start with PK); {appName} refuses live keys and never reaches the live trading API.',
      de: 'Ein Alpaca-Paper-Konto: simulierte Orders für US-Aktien, ETFs und Krypto. Nur Paper-Schlüssel (beginnen mit PK); {appName} lehnt Live-Schlüssel ab und erreicht die Live-Handels-API nie.',
    },
    icon: 'candlestick-chart',
    credentialSchema: [
      {
        key: 'keyId',
        label: { en: 'Paper key ID', de: 'Paper-Key-ID' },
        type: 'string',
        required: true,
        placeholder: 'PK…',
        help: {
          en: 'From the paper dashboard of app.alpaca.markets (paper keys start with PK).',
          de: 'Aus dem Paper-Dashboard von app.alpaca.markets (Paper-Schlüssel beginnen mit PK).',
        },
      },
      {
        key: 'secretKey',
        label: { en: 'Paper secret key', de: 'Paper-Secret-Key' },
        type: 'secret',
        required: true,
      },
      {
        key: 'maxOrderValueUsd',
        label: { en: 'Max. value per order', de: 'Max. Wert je Order' },
        type: 'number',
        required: true,
        placeholder: '1000',
        help: usd,
      },
      {
        key: 'maxPositionValueUsd',
        label: { en: 'Max. value per position', de: 'Max. Wert je Position' },
        type: 'number',
        required: true,
        placeholder: '2000',
        help: usd,
      },
      {
        key: 'maxRiskPerTradeUsd',
        label: {
          en: 'Max. risk per trade (down to the stop)',
          de: 'Max. Risiko je Trade (bis zum Stop)',
        },
        type: 'number',
        required: true,
        placeholder: '50',
        help: usd,
      },
      {
        key: 'dailyLossLimitUsd',
        label: { en: 'Daily loss limit', de: 'Tagesverlustgrenze' },
        type: 'number',
        required: true,
        placeholder: '150',
        help: {
          en: 'USD. Once reached, no new position opens that day; closing stays possible.',
          de: 'USD. Ist sie erreicht, öffnet an dem Tag keine neue Position mehr; Schließen bleibt möglich.',
        },
      },
      {
        key: 'maxOpenPositions',
        label: { en: 'Max. open positions', de: 'Max. offene Positionen' },
        type: 'number',
        required: false,
        placeholder: '5',
      },
      {
        key: 'maxOrdersPerDay',
        label: { en: 'Max. orders per day', de: 'Max. Orders pro Tag' },
        type: 'number',
        required: false,
        placeholder: '20',
      },
      {
        key: 'allowedSymbols',
        label: { en: 'Allowed symbols (empty: all)', de: 'Erlaubte Symbole (leer: alle)' },
        type: 'string',
        required: false,
        placeholder: 'SPY, QQQ, AAPL, BTC/USD',
      },
      {
        key: 'allowCrypto',
        label: { en: 'Allow crypto', de: 'Krypto erlauben' },
        type: 'boolean',
        required: false,
      },
      {
        key: 'tradingHalted',
        label: { en: 'New entries halted', de: 'Handel angehalten (keine neuen Einstiege)' },
        type: 'boolean',
        required: false,
      },
    ],
    auth: { kind: 'fields' },
    services: [
      {
        id: 'paper-trading',
        label: { en: 'Paper trading', de: 'Paper-Trading' },
        actions: ['read', 'write'],
      },
    ],
    async health(credential: CredentialValues): Promise<ConnectorHealth> {
      const checkedAt = new Date().toISOString();
      const keys = readKeys(credential);
      if (!isPaperKeyId(keys.keyId)) {
        return {
          status: 'error',
          message: 'Not a paper key: Alpaca paper keys start with PK.',
          checkedAt,
        };
      }
      const { missing } = readLimits(credential);
      try {
        const account = await new AlpacaPaperClient(keys, deps.fetch ?? fetch).account();
        if (missing.length > 0) {
          return {
            status: 'degraded',
            message: `Limits missing (${missing.join(', ')}): no position can open.`,
            checkedAt,
          };
        }
        return {
          status: account.status === 'ACTIVE' ? 'ok' : 'degraded',
          message: `Paper account ${account.status}, equity ${account.equity} ${account.currency}.`,
          checkedAt,
        };
      } catch (error) {
        return {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          checkedAt,
        };
      }
    },
    tools: alpacaPaperTools(deps),
  };
}

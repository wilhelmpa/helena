---
typ: datenquellen
datum: 2026-09-26
tags: [trading, daten]
---
# Datenquellen

Stand 2026-09. Schlüssel trägt nur der Owner ein (Integrationen bzw. Zugänge); Agenten melden, welcher fehlt.

| Quelle | Daten | Schlüssel | Grenzen | Nutzung | Status |
|---|---|---|---|---|---|
| Alpaca Paper (über `alpaca_paper_*`) | Paper-Konto, US-Aktien (IEX-Feed), Krypto, Kurse und Kerzen | Paper-Schlüssel (Owner) | 200 Abrufe/min | nur Paper | offen: Owner legt Konto an |
| SEC EDGAR | US-Pflichtmitteilungen, XBRL | nein | ≤ 10/s, User-Agent Pflicht | frei | nutzbar |
| EZB Data Portal | Referenzkurse, Zinsen, Inflation | nein | – | Quellenangabe | nutzbar |
| Bundesbank | Makro, Zinsen DE | nein | – | frei | nutzbar |
| Forex-Factory-Wochendatei | Wirtschaftskalender | nein | 1× täglich | inoffiziell | nutzbar |
| CoinGecko | Krypto-Kurse und Märkte | optional | öffentlich begrenzt | Namensnennung | nutzbar |
| Yahoo (yfinance) | global inkl. XETRA | nein | undokumentiert | nur persönliche Recherche | mit Vorsicht |
| Finnhub | News, Termine | ja | 60/min | persönlich | offen: Owner |
| FRED | US-Makro | ja | – | frei | offen: Owner |

**Nicht erlaubt:** Handels-Endpunkte von Börsen und Brokern (gesperrt), Echtgeld-Konten, Quellen ohne Datum.

Python für Backtests (Installation nur mit Freigabe des Owners): pandas, numpy, scikit-learn, statsmodels, backtesting.py (extern), quantstats; nicht vectorbt (Commons Clause).

# Datenquellen – Stand 2026-09

| Quelle | Daten | Schlüssel | Kosten / Grenzen | Nutzung | Handel möglich? |
|---|---|---|---|---|---|
| SEC EDGAR (`data.sec.gov`, `efts.sec.gov`, RSS) | US-Pflichtmitteilungen, XBRL-Zahlen | nein | frei; ≤ 10 Anfragen/s, User-Agent mit Kontakt Pflicht | frei | nein |
| EZB Data Portal (`data-api.ecb.europa.eu`) | Referenzkurse, Zinsen, HICP | nein | frei, Quellenangabe | frei | nein |
| Bundesbank (`api.statistiken.bundesbank.de`) | Makro, Zinsen DE | nein | frei | frei | nein |
| Forex-Factory-Wochendatei (`nfs.faireconomy.media/ff_calendar_thisweek.json`) | Wirtschaftskalender | nein | ≤ 2 Abrufe je 5 min – wir: 1× täglich | inoffiziell | nein |
| CoinGecko (API oder MCP `mcp.api.coingecko.com`) | Krypto-Kurse, Märkte | optional (Demo-Key) | öffentlich begrenzt, Demo ~30/min | Namensnennung Pflicht | nein |
| CoinPaprika | Krypto | nein | 20k Abrufe/Monat | kommerziell erlaubt (Anbieterangabe) | nein |
| Alpaca Market Data (`data.alpaca.markets`) über `alpaca_paper_market`/`alpaca_paper_bars` | US-Aktien (IEX), Krypto | Paper-Schlüssel (Owner) | 200 Abrufe/min, nur IEX-Feed | mit Paper-Konto | nein (reiner Datenhost) |
| Yahoo über yfinance | global inkl. `.DE`, Fundamentaldaten | nein | undokumentierte Drosselung | **nur persönliche Recherche** (Yahoo-Bedingungen) | nein |
| Finnhub | News, Termine, Basisdaten | ja (Owner) | 60/min frei | persönlich, nicht kommerziell | nein |
| FRED | US-Makro | ja (Owner) | frei | frei | nein |
| Alpha Vantage | Aktien, FX, Makro | ja (Owner) | 25/Tag frei | – | nein |

Nicht verwenden: Handels-Endpunkte von Börsen und Brokern (gesperrt), Quellen ohne Datum, kopierte Paywall-Inhalte.

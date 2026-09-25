---
name: paper-trading-ausfuehrung
description: Orders ausschließlich im Alpaca-Paper-Konto über Helenas Werkzeuge alpaca_paper_* ausführen – Voraussetzungen, Checkliste vor jeder Order, Stop-Pflicht, Umgang mit Ablehnungen, Krypto-Stops, Session-Start und -Schluss, Tagesbericht, Not-Aus. Nur für den Paper-Trader.
---

# Paper-Trading ausführen

Du handelst **nur Spielgeld** im Alpaca-Paper-Konto, **nur** mit `alpaca_paper_*`. Es gibt keinen Echtgeld-Handel; andere Wege sind gesperrt und werden gemeldet.

## 1. Voraussetzungen (sonst: nichts tun, melden)
- Die Werkzeuge `alpaca_paper_*` sind dir zugeordnet (sonst fehlt die Verbindung – Owner).
- Die Strategie-Version hat Status `paper` und eine Owner-Freigabe (Front Matter `freigabe`).
- Kein Not-Aus, kein „Handel angehalten“ (`alpaca_paper_account.limits.halted`), keine fehlenden Grenzen (`missingLimits`).

## 2. Checkliste vor jeder Order
1. `alpaca_paper_account`: Equity, Tages-P&L, Orders heute, Grenzen.
2. `alpaca_paper_positions` und offene Orders (`alpaca_paper_orders`): keine Doppel-Einstiege.
3. Setup gegen die Regeln der Version prüfen (jede Regel: erfüllt/nicht erfüllt) und gegen das Regelwerk (regelwerk-und-positionsgroesse); Positionsgröße vorrechnen.
4. `alpaca_paper_check_order` mit denselben Werten. Nur weiter, wenn `ok`.
5. `alpaca_paper_submit_order` mit `stopLossPrice` (Pflicht beim Kauf), optional `takeProfitPrice`, `strategyId`, `strategyVersion`, `rationale` (welche Regel ausgelöst hat).

## 3. Nach der Order
- Den Journal-Eintrag aus der Antwort sofort anlegen (trade-journal-fuehren).
- **Krypto:** Alpaca hängt keinen Stop an. Nach der Ausführung einen `stop_limit`-Verkauf auf Stop-Höhe setzen (gleiche `strategyId`/`strategyVersion`), Ausführung mit `alpaca_paper_orders` prüfen.
- Aktien: Stop/Ziel hängen als OTO/Bracket an der Order.

## 4. Ablehnung oder Fehler
Helena lehnt Orders ab, die eine Grenze verletzen. **Nicht** umgehen, aufteilen, wiederholen oder Parameter „passend machen“. Grund in den Tagesbericht, dem Koordinator melden. Technische Fehler: einmal lesen (`alpaca_paper_orders`), ob die Order doch angekommen ist; dann melden, nicht blind neu senden.

## 5. Session
- **Start (US 15:40 MEZ bzw. nach der Eröffnungsspanne):** Uhr prüfen (`alpaca_paper_market` → `market.open`), Pre-Market-Briefing lesen, nur dessen erlaubte Setups.
- **Schluss (US 21:50 MEZ):** Daytrading-Positionen nach Regel schließen (`alpaca_paper_close_position`), offene Tagesorders stornieren (`alpaca_paper_cancel_order`).
- In den Umstellungswochen eine Stunde früher (premarket-briefing §1).

## 6. Tagesbericht (nach Handelsschluss)
Vorlage „Tagesbericht“ in `Berichte/`: Equity, Tages-P&L (USD, %), offene Positionen mit Stop, ausgeführte und abgelehnte Orders (mit Gründen), Regelverstöße (sollte leer sein), Journal vollständig ja/nein, Links auf alle Journal-Einträge des Tages.

## 7. Nie
Andere Broker/Börsen/Hosts, Leerverkäufe, Hebel, Optionen, Orders ohne Stop, Orders für nicht freigegebene Versionen, Orders „zum Testen“.

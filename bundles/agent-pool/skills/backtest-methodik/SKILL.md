---
name: backtest-methodik
description: Backtests reproduzierbar und ehrlich – Daten mit Quelle, Kosten und Slippage, In-Sample/Out-of-Sample, Walk-Forward, Mindestzahl an Trades, Parameter-Stabilität und Überanpassungs-Checks, Kennzahlen, Ergebnisdateien als Anhänge, Gate-Urteil für das Strategie-Labor. Nutze ihn für jeden Backtest.
---

# Backtest-Methodik

Ziel ist die Strategie, die **am wenigsten bricht**, nicht die mit der schönsten Kurve (backtest-expert). Ein Backtest ist keine Prognose.

## 1. Vorbereitung
- Strategie-Version lesen: Regeln, Parameter, Universum, Zeitrahmen, Kosten. Mehrdeutiges nicht auslegen → Rückfrage an die Strategie-Entwicklung.
- Daten: Quelle, Zeitraum, Zeitzone, Bereinigung (Splits, Dividenden), Survivorship (heutige Indexmitglieder ≠ damalige), Lücken prüfen (ohlcv-processing).

## 2. Umgebung
- Python im Arbeitsbereich, Bereich `strategie-labor/backtests/<id>/v<version>/` (Skript, Konfiguration, Ergebnis). Fester Seed, Paket-Versionen im Kopf des Skripts.
- Empfohlen: pandas, numpy, scikit-learn (`TimeSeriesSplit`), statsmodels; als Engine backtesting.py (AGPL, extern ausführen) oder eine eigene Vektor-Schleife; Kennzahlen selbst berechnen. **Nicht** vectorbt (Commons Clause). Fehlt ein Paket: melden, nicht selbst installieren (der Owner gibt Installationen frei).

## 3. Ablauf
1. **In-Sample** (ca. 60–70 % des Zeitraums): Parameter höchstens grob wählen, Anzahl der ausprobierten Varianten mitschreiben.
2. **Out-of-Sample** (der Rest, zeitlich danach, unberührt): einmal laufen lassen.
3. **Walk-Forward** (walk-forward-validation): rollende Fenster, Walk-Forward-Effizienz = OOS-Ergebnis / IS-Ergebnis.
4. **Kosten:** Gebühren, Spread, Slippage (Aktien mind. 1 Tick + Spread/2; Krypto Gebühr + Spread), bei Daytrading doppelt rechnen als Stresstest.
5. **Robustheit:** Parameter ±20 % (Plateau statt Spitze), anderer Zeitraum/Markt, Zufallsreihenfolge der Trades (Monte Carlo) für den Drawdown.

## 4. Kennzahlen (IS und OOS getrennt)
Trades, Trefferquote, Erwartungswert je Trade (USD und R), Profitfaktor, max. Drawdown, Sharpe (annualisiert), durchschnittliche Haltedauer, Exposure, Kosten gesamt.

## 5. Gate B (Strategie-Labor) – alle nötig
- Mindestens **100 Trades** (Daytrading) bzw. **30 Trades** (Swing) im In-Sample, mindestens 30 im Out-of-Sample.
- Out-of-Sample nach Kosten: Erwartungswert > 0 und Profitfaktor ≥ 1,2.
- Walk-Forward-Effizienz ≥ 0,5; Parameter-Nachbarn (±20 %) bleiben profitabel.
- Max. Drawdown im Rahmen des Regelwerks (auf die Paper-Grenzen skaliert).
- Zahl der ausprobierten Varianten dokumentiert (viele Varianten → strengere Maßstäbe).

## 6. Ergebnis
- Notiz aus der Vorlage „Backtest“ in `Backtests/`, Ergebnis `bestanden`/`nicht-bestanden` mit Begründung je Kriterium.
- Dateien (Trades-CSV, Equity-PNG, Parameter-Heatmap) mit `add_attachment` an die Aufgabe, in der Notiz eingebunden; Dateinamen `<id>-v<version>-<art>.<endung>`.
- Verlinken: Strategie-Version (Feld `backtest`), Index-Notiz der Strategie, Board.
- Hinweis „Keine Anlageberatung – Backtests sind keine Prognose“.

---
name: technische-analyse
description: Reproduzierbare Chartanalyse – Daten mit Quelle und Zeitrahmen, Trend und Struktur über mehrere Zeitrahmen, Unterstützungen und Widerstände als Zonen, ATR und Volatilität, Marktregime, Szenarien mit Ungültigkeitspunkt statt Prognosen. Nutze ihn für jede Chart-, Level- oder Regime-Frage.
---

# Technische Analyse (reproduzierbar)

Eine Chartanalyse ist nur etwas wert, wenn jemand anderes mit **denselben Daten** zu denselben Linien kommt.

## 1. Daten festhalten
- Instrument (Ticker/ISIN, Handelsplatz), Quelle (`alpaca_paper_bars` mit Feed, oder die Quelle aus `Datenquellen`), Zeitrahmen, Zeitraum, Bereinigung (Splits/Dividenden), Zeitzone.
- Lücken, Feiertage, geringe Volumina nennen (IEX-Feed hat weniger Volumen als der Gesamtmarkt).

## 2. Von oben nach unten
1. **Wochen-/Tageschart:** Trend (höhere Hochs/Tiefs), gleitende Durchschnitte (50/200 Tage, Steigung), Lage zum letzten Jahreshoch/-tief.
2. **Stunden-/15-Minuten-Chart** (für Daytrading): Vortageshoch/-tief/-schluss, Eröffnungsspanne, Gap, Volumen-Profil falls verfügbar.
3. **Levels als Zonen** (von–bis), je mit Grund: Pivot-Hoch/-Tief, Gap-Kante, häufig getestete Zone, runde Marke. Höchstens 3 je Richtung.

## 3. Volatilität und Regime
- ATR(14) im Tageschart und in Prozent vom Kurs; daraus realistische Stop-Abstände (z. B. 1–2 ATR) für die Positionsgröße (regelwerk-und-positionsgroesse).
- Regime: Trend / Seitwärts / hohe Volatilität (regime-detection); bei „hohe Volatilität“ ausdrücklich warnen.
- Korrelationen zwischen Positionen, wenn mehrere gleichzeitig offen wären (correlation-analysis).

## 4. Indikatoren
Nur mit Parametern (RSI(14), MACD(12,26,9) …) und nur, wenn sie etwas erklären. Kein Indikator-Zoo. Formeln und Muster: ta-lib als Referenz.

## 5. Szenarien statt Vorhersagen
Je Richtung ein Szenario: **Auslöser** (Schluss über/unter Zone), **Ziel-Zone**, **Ungültig bei**, **Chance-Risiko-Verhältnis**. Kein Szenario ist ein Handelsauftrag; Einstiege gibt es nur über freigegebene Strategie-Versionen.

## 6. Ergebnis
- `create_chart` mit Kurs und Levels, die Analyse als Notiz (Vorlage „Analyse“) in `Research/` bzw. der Instrument-Notiz in `Märkte/`, verlinkt (trading-wissen-verknuepfen).
- Am Ende der Hinweis „Keine Anlageberatung“ (trading-grundregeln).

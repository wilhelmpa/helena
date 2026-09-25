---
name: marktrecherche-und-news
description: Markt- und Nachrichtenrecherche für Aktien und Krypto mit deutschen und EU-Besonderheiten – Primärquellen (Ad-hoc-Mitteilungen, SEC EDGAR, Notenbanken), Wirtschaftskalender ohne Schlüssel, Relevanz für Watchlist und Positionen, Einordnung mit trading_classify, Ablage als verlinkte Analyse. Nutze ihn für jede Nachrichtenlage, Unternehmens- oder Makrorecherche.
---

# Marktrecherche und Nachrichten

Ziel: **Was ist passiert, was bedeutet es für die Werte auf der Watchlist und die offenen Positionen, wie sicher ist das?** – belegt, datiert, knapp.

## 1. Vorher prüfen
- Watchlist (`Märkte/Trading-Watchlist.md`) und offene Positionen lesen; frühere Analysen mit `search_knowledge` (Ordner `Projects/<KEY>/Docs`).
- Zeitraum festlegen (seit letztem Briefing, seit Handelsschluss) und Zeitzone nennen (MEZ/MESZ).

## 2. Quellen (Reihenfolge)
| Stufe | Quelle | Wofür |
|---|---|---|
| A | Pflichtmitteilungen: Ad-hoc (MAR Art. 17) und Directors' Dealings über die Unternehmensseite oder den Veröffentlichungsdienst, SEC EDGAR (8-K, 10-Q/10-K, Form 4; `data.sec.gov` mit User-Agent, ≤ 10 Anfragen/s), Investor-Relations-Seiten | Unternehmensereignisse |
| A | EZB (`data-api.ecb.europa.eu`), Bundesbank, Fed, Destatis, BLS/BEA | Makro, Zinsen |
| A | BaFin (Mitteilungen, Leerverkaufs-Register) | Aufsicht |
| B | Fachpresse mit Datum, Börsenpflichtblätter | Einordnung |
| C | Foren, Social Media, „Börsenbriefe“ | nur als Hinweis, nie allein |

Wirtschaftskalender ohne Schlüssel: Forex-Factory-Wochendatei (`nfs.faireconomy.media/ff_calendar_thisweek.json`, höchstens einmal täglich), Termine der EZB/Fed von deren Seiten. Details und Lizenzen: `refs/quellen.md` und die Projektnotiz `Datenquellen`.

## 3. Einordnen
- Je Meldung: **Worum geht es** (ein Satz), **welches Instrument**, **erwartet oder überraschend** (gegen Konsens/Prognose, mit Quelle), **Relevanz** (hoch/mittel/niedrig/keine), **Richtung** (positiv/negativ/neutral/gemischt), **Art** (Zahlen, Makro, Regulierung, Unternehmen, Krypto).
- Mit `trading_classify` (kind `news`, Kontext: Watchlist + Positionen + Meldung) vorsortieren, wenn die Klasse eingeschaltet ist. Nur Antworten mit `decided` übernehmen; `unsure`/`off` → selbst einordnen. **Nie** eine Einordnung als Kauf- oder Verkaufssignal verwenden.
- Widersprüche offenlegen; Gerüchte als Gerüchte kennzeichnen.

## 4. Deutsche und EU-Besonderheiten
- XETRA 09:00–17:30 Uhr; Tradegate/Lang & Schwarz mit längeren Zeiten (dünnere Liquidität).
- Wertpapiere mit ISIN/WKN und Handelsplatz angeben; US-Werte mit Ticker und Börse.
- US-Zahlen kommen meist vor 15:30 oder nach 22:00 Uhr unserer Zeit (in den Umstellungswochen eine Stunde früher).

## 5. Ergebnis
- Nachrichtenlage: Notiz aus der Vorlage „Analyse“ in `Research/`, oben 3–5 Punkte „Was zählt heute“, dann je Meldung eine Zeile (Tabelle), unten Quellen.
- Einzelanalyse (Unternehmen, Makro): Vorlage „Analyse“ vollständig.
- Verlinken nach trading-wissen-verknuepfen (Watchlist-Notiz, Thesen, betroffene Strategien).
- Hinweis „Keine Anlageberatung“ am Ende (trading-grundregeln).

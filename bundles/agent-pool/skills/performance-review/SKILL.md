---
name: performance-review
description: Wochen- und Monatsreview des Paper-Tradings – Kennzahlen je Strategie-Version (Trefferquote, Erwartungswert in R, Profitfaktor, Drawdown) gegen den Backtest, Regelverstöße, Journal-Vollständigkeit, Lehren als Memory-Vorschlag, wiederkehrende Abläufe als Skill-Vorschlag, Fortschritt an den Zielen. Nutze ihn für jedes Review.
---

# Performance-Review (Woche / Monat)

Das Review beantwortet: **Verhält sich jede Strategie-Version wie im Backtest? Halten wir unsere Regeln? Was lernen wir?**

## 1. Daten sammeln
- Journal-Einträge des Zeitraums (`list_folder` `Journal/<JJJJ>`, `search_knowledge`), Tagesberichte, `alpaca_paper_orders`/`alpaca_paper_account` für Abgleich und Equity.
- Journal-Vollständigkeit zuerst prüfen (trade-journal-fuehren §3); Lücken benennen.

## 2. Kennzahlen je Strategie-Version
| Kennzahl | Formel |
|---|---|
| Trades | Anzahl geschlossener Trades |
| Trefferquote | Gewinner / Trades |
| Durchschnitt Gewinn / Verlust in R | Mittel der R-Werte je Gruppe |
| Erwartungswert (R) | Trefferquote × Ø Gewinn R − (1 − Trefferquote) × Ø Verlust R |
| Profitfaktor | Summe Gewinne / Summe Verluste (USD) |
| Max. Drawdown | größter Rückgang der kumulierten Ergebnisse (USD und R) |
| Regeltreue | Anteil Trades mit `regel_eingehalten: ja` |

Gegen den Backtest der Version stellen (gleiche Kennzahlen). Unter 20 Trades: Ergebnisse als „noch nicht aussagekräftig“ kennzeichnen. Diagramme (Equity-Kurve, R-Verteilung) mit `create_chart`.

## 3. Befunde
- Abweichungen vom Backtest mit möglicher Ursache (Regime, Ausführung, Kosten, Regelbruch, Zufall bei kleiner Zahl).
- Kriterien des Strategie-Labors prüfen (Pausieren/Ausmustern, strategie-labor §6) und die Empfehlung klar sagen.
- Regelverstöße einzeln mit Trade-Link.

## 4. Lernen (Hermes)
- **Lehren, die bleiben sollen** (z. B. „Setup X versagt bei hoher Volatilität“, „Owner will keine Trades vor der Fed“), als kurze Memory-Einträge vorschlagen – der Owner bestätigt sie (Memory-Freigabe ist an). Keine Einzeltrade-Details ins Memory.
- **Wiederkehrende Abläufe** (ein Auswertungsschritt, den du jede Woche gleich machst) als Skill-Vorschlag festhalten; {appName} zeigt gelernte Skills dem Owner zur Übernahme.
- **Verbesserungsideen** als Aufgabe an @strategy-developer-<key> (neue Version), nie als direkte Änderung einer gehandelten Version.

## 5. Ziele
Fortschritt als Notiz am passenden Ziel (Ziel-Werkzeuge wie `add_goal_note`, wenn verfügbar; sonst Kommentar in der Ziel-Aufgabe): Trades, Wochen im Paper-Trading, Journal-Vollständigkeit.

## 6. Ablage
Notiz aus „Wochenreview“/„Monatsreview“ in `Reviews/`, verlinkt mit allen betrachteten Versionen, Trades und dem Board; Hinweis „Keine Anlageberatung“.

---
typ: prozess
datum: 2026-09-26
tags: [trading, strategie-labor]
---
# Strategie-Labor

Wie aus einer Idee eine geprüfte Strategie wird – und wie sie sich verbessert. Ausführlich im Skill `strategie-labor`; das Board „Strategie-Labor“ zeigt den Stand.

## Kreislauf
1. **Idee** – Hypothese in einem Satz, mit Begründung und Quelle ([[Trading-Research]], [[Trading-Reviews]]).
2. **Strategie-Notiz** – eindeutige Regeln und Parameter, Version v1.0, Index-Notiz der Strategie ([[Trading-Strategien]]). *Gate A:* Regeln eindeutig, Pre-Mortem gemacht.
3. **Backtest** – In-/Out-of-Sample, Walk-Forward, Kosten, genug Trades ([[Trading-Backtests]]). *Gate B:* Kriterien aus `backtest-methodik` erfüllt.
4. **Freigabe** – der Owner gibt die Version frei (Freigabe-Anfrage). *Gate C.*
5. **Paper-Trading** – kleine Größe, mindestens 4 Wochen und 20 Trades ([[Trading-Journal]], [[Trading-Berichte]]).
6. **Review** – Kennzahlen gegen den Backtest, Regeltreue, Lehren ([[Trading-Reviews]]).
7. **Verbesserung** – neue Version (1–2 Änderungen) → zurück zu 3; oder **Pausieren/Ausmustern** nach den Kriterien.

## Regeln
- Eine Version, die gehandelt hat, wird nie geändert.
- Jede Paper-Order trägt Strategie-ID und Version; jeder Trade steht im Journal.
- Lehren werden als Memory-Vorschlag festgehalten, wiederkehrende Abläufe als Skill-Vorschlag – der Owner bestätigt.

## Pausieren / Ausmustern (nach ≥ 30 Paper-Trades oder 6 Wochen)
Erwartungswert ≤ 0 R, Profitfaktor < 1,0, max. Drawdown > 1,5 × Backtest, Trefferquote > 15 Prozentpunkte unter dem Backtest oder Regeltreue < 90 % → pausieren und prüfen; zwei Reviews in Folge ohne plausible Verbesserung → ausmustern.

## Ziel
„Strategie-Labor: erste Strategie durch Backtest und 4 Wochen Paper-Trading“ – Fortschritt in den Wochenreviews.

> Hinweis: Keine Anlageberatung. Strategien sind Hypothesen; Entscheidungen und Risiko liegen beim Owner.

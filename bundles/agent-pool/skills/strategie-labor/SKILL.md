---
name: strategie-labor
description: Der Kreislauf des Strategie-Labors – Idee, Strategie-Notiz mit Version, Backtest, Owner-Freigabe, Paper-Trading, Journal, Review, Verbesserung als neue Version oder Ausmustern – mit Status, Gates, Versionsregeln, Rollen, Board und Zielen. Nutze ihn für alles, was eine Strategie weiterbringt.
---

# Strategie-Labor

Das Labor verbessert Strategien in kleinen, geprüften Schritten. **Keine Strategie ohne schriftliche Regeln, kein Paper-Trading ohne bestandenen Backtest und Owner-Freigabe, keine Änderung an einer Version, die gehandelt hat.**

## 1. Kreislauf und Status
```
idee → entwurf → backtest → freigabe-angefragt → paper → (review) → neue Version (entwurf) …
                                       ↘ nicht bestanden → entwurf / ausgemustert
paper → pausiert → ausgemustert
```
| Status | Wer | Übergang, wenn … |
|---|---|---|
| idee | alle (Research, Journal-Lehren) | Hypothese in einem Satz + Begründung + Quelle |
| entwurf | Strategie-Entwicklung | **Gate A:** Regeln eindeutig (Einstieg, Ausstieg, Stop, Größe, Filter, Zeiten, Universum, Parameter), Pre-Mortem gemacht |
| backtest | Backtesting | **Gate B:** Kriterien aus backtest-methodik §5 erfüllt |
| freigabe-angefragt | Strategie-Entwicklung | `request_approval` mit Zusammenfassung, Backtest-Link, erwarteten Kennzahlen, Risiken |
| paper | Paper-Trader handelt | **Gate C:** Owner-Freigabe liegt vor (Freigabe-ID im Front Matter) |
| pausiert | Risiko & Journal / Owner | Kriterium aus §6 ausgelöst |
| ausgemustert | Strategie-Entwicklung | Kriterium aus §6, Begründung in der Index-Notiz |

## 2. Versionen
- Jede Version ist eine eigene Notiz `Strategien/<id>/<id> v<major>.<minor>.md` (Vorlage „Strategie“), Feld `vorgaenger`.
- **Nie** eine Version ändern, die gehandelt hat. Verbesserung = neue Version: höchstens ein bis zwei Regeln oder Parameter ändern, Grund und erwartete Wirkung nennen, dann wieder Gate B und Gate C.
- Tippfehler/Klarstellung ohne Regelwirkung: Minor-Version, trotzdem neue Notiz.

## 3. Rollen
Strategie-Entwicklung: Hypothesen, Versionen, Vorschläge, Ausmustern · Backtesting: Gate B · Paper-Trader: Ausführung · Risiko & Journal: Journal, Reviews, Kennzahlen, Lehren · Koordinator: Reihenfolge, Freigaben einholen, Board · Owner: Gate C, Regelwerk.

## 4. Paper-Phase
Mindestens **4 Wochen und 20 Trades**, bevor über die Version geurteilt wird; kleine Größe (Regelwerk). Jede Order trägt `strategyId` und `strategyVersion`, jeder Trade ist im Journal.

## 5. Lernen
- Wochenreview vergleicht Paper mit Backtest (performance-review); Lehren als Memory-Vorschlag, wiederkehrende Schritte als Skill-Vorschlag.
- Aus Lehren werden Ideen (Status idee) mit Link auf das Review.

## 6. Pausieren und Ausmustern (nach ≥ 30 Paper-Trades oder 6 Wochen)
- Pausieren, wenn eins zutrifft: Erwartungswert ≤ 0 R; Profitfaktor < 1,0; max. Drawdown > 1,5 × Backtest; Trefferquote weicht > 15 Prozentpunkte vom Backtest ab; Regeltreue < 90 %.
- Ausmustern: nach zwei Reviews in Folge mit Pausier-Befund ohne plausible Verbesserung, oder wenn die Hypothese widerlegt ist.
- Ausgemusterte Versionen bleiben im Wissen (Lernmaterial), mit Grund.

## 7. Board und Ziele
- Board „Strategie-Labor“: jede Strategie als Sticker in ihrer Spalte, mit Link auf die Index-Notiz; beim Statuswechsel mitziehen.
- Ziel „Strategie-Labor: erste Strategie durch Backtest und 4 Wochen Paper-Trading“: Fortschritt als Ziel-Notiz (Wochenreview).

## 8. Freigabe-Text (Gate C, Vorlage)
```
Strategie <id> v<version> für Paper-Trading freigeben?
Idee: … · Regeln: [[<id> v<version>]] · Backtest: [[…]] (OOS: Trades, Erwartungswert R, PF, max. DD)
Risiko je Trade / Tagesgrenze laut Regelwerk: … · Erwartete Paper-Dauer: 4 Wochen
Risiken und Unsicherheit: …   Hinweis: Keine Anlageberatung.
```

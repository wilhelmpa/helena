---
typ: strategie
strategie: spy-rsi2
version: "1.0"
status: entwurf
markt: aktien
zeitrahmen: 1d
instrumente: [SPY]
vorgaenger:
backtest:
freigabe:
datum: 2026-09-26
tags: [trading, strategie, aktien]
---
# spy-rsi2 v1.0

Index: [[spy-rsi2]] · Regelwerk: [[Regelwerk]]

## Hypothese
Kurze, starke Rücksetzer im breiten US-Markt erholen sich über einige Tage häufig, solange der langfristige Trend steigt (bekanntes RSI(2)-Muster). Ob der Vorteil heute noch nach Kosten besteht, klärt der Backtest.

## Regeln
| Teil | Regel |
|---|---|
| Universum | SPY |
| Zeitfenster | Prüfung kurz vor Handelsschluss (15:45 New York) |
| Filter | Kurs über dem 200-Tage-Durchschnitt |
| Einstieg | Kauf, wenn RSI(2) unter 10 liegt |
| Stop | 2 × ATR(14) unter dem Einstieg (als OTO an der Order) |
| Ziel / Ausstieg | Verkauf, wenn der Schluss über dem 5-Tage-Durchschnitt liegt, spätestens nach 10 Handelstagen |
| Positionsgröße | nach [[Regelwerk]]: Risiko je Trade / (2 × ATR) |
| Nicht handeln wenn | schon eine Position offen; Zahlen großer Index-Schwergewichte am Folgetag |

## Parameter
| Name | Wert | Spielraum |
|---|---|---|
| RSI-Länge / Schwelle | 2 / 10 | 2–3 / 5–15 |
| Ausstieg | 5-Tage-Durchschnitt | 3–10 |
| Trendfilter | 200 Tage | 100–200 |

## Pre-Mortem
Scheitert, wenn der Vorteil durch viele Nachahmer verschwunden ist, in Crashphasen, in denen Rücksetzer weiterlaufen (der Trendfilter greift zu spät), oder wenn der Stop zu eng für die Tagesschwankung ist.

## Erwartung
Hohe Trefferquote (60–70 %), kleine durchschnittliche Gewinne, etwa 2–4 Trades pro Monat – zu prüfen.

## Verlauf
- 2026-09-26: als Startkandidat angelegt (Entwurf, nicht getestet)

> Hinweis: Keine Anlageberatung. Strategien sind Hypothesen; Entscheidungen und Risiko liegen beim Owner.

---
typ: strategie
strategie: orb-spy
version: "1.0"
status: entwurf
markt: aktien
zeitrahmen: 5m
instrumente: [SPY]
vorgaenger:
backtest:
freigabe:
datum: 2026-09-26
tags: [trading, strategie, daytrading]
---
# orb-spy v1.0

Index: [[orb-spy]] · Regelwerk: [[Regelwerk]]

## Hypothese
Bricht der SPY in Trendphasen über die Spanne der ersten 15 Handelsminuten aus, setzt sich die Bewegung häufiger fort als sie scheitert. Bekanntes, einfaches Muster (Opening Range Breakout); ob es nach Kosten trägt, klärt der Backtest.

## Regeln
| Teil | Regel |
|---|---|
| Universum | SPY |
| Zeitfenster | Einstieg 09:45–11:30 New York; Schluss spätestens 15:50 New York |
| Filter | Schlusskurs des Vortags über dem 20-Tage-Durchschnitt; kein Fed-, US-Arbeitsmarkt- oder US-Inflationstermin am Tag |
| Eröffnungsspanne | Hoch und Tief der 5-Minuten-Kerzen 09:30–09:45 |
| Einstieg | Kauf, wenn eine 5-Minuten-Kerze über dem Hoch der Spanne schließt (Market-Order zur nächsten Kerze) |
| Stop | Tief der Eröffnungsspanne |
| Ziel / Ausstieg | 2 R über dem Einstieg; sonst Schluss um 15:50 New York |
| Positionsgröße | nach [[Regelwerk]]: Risiko je Trade / (Einstieg − Stop), abgerundet |
| Nicht handeln wenn | Spanne größer als die Hälfte der ATR(14) des Tagescharts; schon ein Trade heute |

## Parameter
| Name | Wert | Spielraum |
|---|---|---|
| Spanne | 15 min | 10–30 min |
| Ziel | 2 R | 1,5–3 R |
| Trendfilter | 20 Tage | 10–50 Tage |

## Pre-Mortem
Scheitert, wenn Ausbrüche in Seitwärtsphasen meist zurücklaufen, die Kosten (Spread, Slippage bei Market-Orders) den kleinen Vorteil fressen oder der IEX-Feed die Spanne anders zeigt als der Gesamtmarkt.

## Erwartung
Trefferquote um 40–50 %, Erwartungswert klein positiv, etwa 8–12 Trades pro Monat – zu prüfen.

## Verlauf
- 2026-09-26: als Startkandidat angelegt (Entwurf, nicht getestet)

> Hinweis: Keine Anlageberatung. Strategien sind Hypothesen; Entscheidungen und Risiko liegen beim Owner.

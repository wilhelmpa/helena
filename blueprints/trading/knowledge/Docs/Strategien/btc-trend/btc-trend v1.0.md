---
typ: strategie
strategie: btc-trend
version: "1.0"
status: entwurf
markt: krypto
zeitrahmen: 1d
instrumente: [BTC/USD]
vorgaenger:
backtest:
freigabe:
datum: 2026-09-26
tags: [trading, strategie, krypto]
---
# btc-trend v1.0

Index: [[btc-trend]] · Regelwerk: [[Regelwerk]]

## Hypothese
Bitcoin bewegt sich in langen Trends; ein Ausbruch auf ein 20-Tage-Hoch über dem steigenden 50-Tage-Durchschnitt fängt einen Teil davon, und ein nachgezogener Ausstieg begrenzt die Rückschläge. Klassische Donchian-Trendfolge; ob sie nach Kosten trägt, klärt der Backtest.

## Regeln
| Teil | Regel |
|---|---|
| Universum | BTC/USD |
| Zeitfenster | Prüfung einmal täglich nach dem Tagesschluss (00:00 UTC) |
| Filter | Schlusskurs über dem 50-Tage-Durchschnitt, der Durchschnitt steigt (heute > vor 5 Tagen) |
| Einstieg | Kauf, wenn der Schlusskurs über dem höchsten Schluss der letzten 20 Tage liegt |
| Stop | 2 × ATR(14) unter dem Einstieg, nach der Ausführung als Stop-Limit-Verkauf |
| Ziel / Ausstieg | Verkauf, wenn der Schluss unter dem tiefsten Schluss der letzten 10 Tage liegt, oder Stop |
| Positionsgröße | nach [[Regelwerk]]: Risiko je Trade / (2 × ATR) |
| Nicht handeln wenn | schon eine Position offen |

## Parameter
| Name | Wert | Spielraum |
|---|---|---|
| Ausbruch | 20 Tage | 15–30 |
| Ausstieg | 10 Tage | 7–15 |
| Trendfilter | 50 Tage | 30–100 |
| Stop | 2 ATR | 1,5–3 |

## Pre-Mortem
Scheitert in langen Seitwärtsphasen (viele kleine Verluste), bei Kurslücken am Wochenende über den Stop hinweg und wenn die Gebühren bei kleiner Größe den Vorteil fressen.

## Erwartung
Wenige Trades (etwa 5–10 pro Jahr), Trefferquote um 35–45 %, einzelne große Gewinner – zu prüfen; die Paper-Phase braucht dafür länger als 4 Wochen.

## Verlauf
- 2026-09-26: als Startkandidat angelegt (Entwurf, nicht getestet)

> Hinweis: Keine Anlageberatung. Strategien sind Hypothesen; Entscheidungen und Risiko liegen beim Owner.

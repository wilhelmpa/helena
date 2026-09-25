---
typ: regelwerk
version: "0.1"
status: entwurf
gueltig_ab:
freigabe:
datum: 2026-09-26
tags: [trading, regelwerk]
---
# Regelwerk

> **Entwurf – der Owner legt die Zahlen fest** (Ziel „Trading-Regelwerk schriftlich festlegen“). Bis zur Freigabe gelten die strengeren der Werte unten und der Grenzen in der Paper-Verbindung (Integrationen → Alpaca Paper-Trading). Helena prüft die Grenzen der Verbindung vor jeder Order.

## 1. Geltungsbereich
- Nur Paper-Trading im Alpaca-Paper-Konto (Spielgeld). Kein Echtgeld.
- Märkte: US-Aktien und ETFs, Krypto (BTC/USD, ETH/USD) – **offen: Owner**.
- Nur Strategie-Versionen mit Status `paper` und Owner-Freigabe ([[Strategie-Labor]]).

## 2. Risiko
| Regel | Wert (Vorschlag) | Grenze in der Verbindung |
|---|---|---|
| Risiko je Trade (bis zum Stop) | 0,5 % der Paper-Equity, höchstens 50 USD | `maxRiskPerTradeUsd` |
| Tagesverlustgrenze | 1,5 % der Paper-Equity, höchstens 150 USD | `dailyLossLimitUsd` |
| Max. Wert je Order | 1.000 USD | `maxOrderValueUsd` |
| Max. Wert je Position | 2.000 USD | `maxPositionValueUsd` |
| Max. offene Positionen | 5 | `maxOpenPositions` |
| Max. Orders pro Tag | 20 | `maxOrdersPerDay` |

## 3. Einstieg
- Nur, wenn alle Regeln der Strategie-Version erfüllt sind (Checkliste im Journal-Eintrag).
- Jeder Einstieg hat vorher einen festen Stop; Chance-Risiko nach Kosten mindestens 1,5 : 1.
- Kein Einstieg in den ersten 5 Minuten nach Handelsbeginn und nicht in den 60 Minuten vor Fed, EZB, US-Arbeitsmarkt- und US-Inflationsdaten.
- Keine Positionen über Zahlen des Unternehmens (3 Handelstage vorher).
- Mindestens 1 Mio. Stück durchschnittliches Tagesvolumen (Aktien).

## 4. Ausstieg
- Stop wird nie weiter weg gelegt; nachziehen erlaubt.
- Daytrades werden vor Handelsschluss geschlossen.
- Nach Erreichen der Tagesverlustgrenze: keine neuen Trades an diesem Tag.

## 5. Verboten
Nachkaufen im Minus, Trades ohne Stop, „Aufholen“ nach Verlusten, Leerverkäufe, Hebel, Optionen, Strategien ohne Freigabe.

## 6. Positionsgröße
Stückzahl = abrunden(Risikobudget / (Einstieg − Stop)); Orderwert und Positionswert gegen die Grenzen prüfen (Skill regelwerk-und-positionsgroesse).

## Vorschläge
– (Änderungen als Entwurf mit Begründung, Freigabe durch den Owner)

## Änderungen
- 0.1 (2026-09-26): Entwurf angelegt.

> Hinweis: Keine Anlageberatung. Entscheidungen und Risiko liegen beim Owner.

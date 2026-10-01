---
name: trade-journal-fuehren
description: Das Trade-Journal lückenlos führen – ein Eintrag je Paper-Order aus der Vorlage „Trade“, sofort nach der Order, verknüpft mit Strategie-Version und Tagesbericht; nach dem Schluss Ergebnis in USD und R, Regeltreue, Abweichungen; täglicher Abgleich mit den Paper-Orders über die clientOrderId. Nutze ihn bei jeder Order, jedem Schluss und jedem Abgleich.
---

# Trade-Journal führen

Das Journal ist die Datengrundlage des Strategie-Labors. **Kein Trade ohne Eintrag, kein Eintrag ohne Strategie-Version.**

## 1. Beim Einstieg (sofort)
- `alpaca_paper_submit_order` liefert `journal` (Front Matter + Kopf). Daraus eine Notiz nach der Vorlage „Trade“ in `Journal/<JJJJ>/<JJJJ-MM-TT> <SYMBOL> <strategie> v<version>.md` anlegen.
- Ergänzen: Setup (welche Regel der Version hat ausgelöst), Marktlage in zwei Sätzen, geplanter Stop/Ziel, Risiko in USD und als 1 R, Links: `[[<strategie> v<version>]]`, heutiger Tagesbericht, Pre-Market-Briefing.
- Wird die Order abgelehnt: kein Trade-Eintrag, aber eine Zeile im Tagesbericht mit den Gründen.

## 2. Beim Schluss
Front Matter ergänzen: `ausstieg`, `ergebnis_usd`, `ergebnis_r` (= Ergebnis / anfängliches Risiko), `haltedauer`, `regel_eingehalten` (ja/nein), `status: geschlossen`. Abschnitt „Nachbetrachtung“: Was lief nach Plan, was nicht, Abweichung von der Regel (mit Grund), eine Lehre in einem Satz.

## 3. Täglicher Abgleich
- `alpaca_paper_orders` (status `all`, seit gestern) gegen die Journal-Einträge: jede Order mit `clientOrderId` „helena-<strategie>-v<version>-…“ braucht einen Eintrag; Teilausführungen und Bracket-Beine gehören zum selben Eintrag.
- Fehlt ein Eintrag: nachtragen (als „nachgetragen“ markieren) und im Tagesbericht vermerken. Orders ohne `helena-`-Präfix: sofort dem Owner melden (dürfte es nicht geben).

## 4. Qualität
- Zahlen aus dem Paper-Konto übernehmen, nicht schätzen; Zeiten mit Zeitzone.
- Keine nachträglichen Beschönigungen: Einträge werden ergänzt, nicht umgeschrieben (Git-Historie).
- Jede Journal-Notiz ist verlinkt (trading-wissen-verknuepfen): Strategie-Version, Tagesbericht; die Index-Notiz der Strategie führt die Anzahl Trades.

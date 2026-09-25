---
name: regelwerk-und-positionsgroesse
description: Das Trading-Regelwerk lesen, anwenden und weiterentwickeln – Risiko je Trade, Tagesverlustgrenze, Positionsgröße aus Risiko und Stop-Abstand, Kosten, verbotene Muster – und mit den harten Grenzen der Paper-Verbindung abgleichen. Nutze ihn vor jedem geplanten Trade, für jede Positionsgröße und jede Regeländerung.
---

# Regelwerk und Positionsgröße

`Projects/<KEY>/Docs/Regelwerk.md` ist das **gültige** Regelwerk. Es gilt über jeder Strategie. Die **harten Grenzen** stehen zusätzlich in der Paper-Verbindung (vom Owner gesetzt) und werden von Helena vor jeder Order erzwungen; `alpaca_paper_account` zeigt sie.

## 1. Anwenden
Vor jedem geplanten Trade die Checkliste des Regelwerks durchgehen und jede Regel mit „erfüllt / nicht erfüllt / nicht prüfbar“ beantworten. Für einzelne Regeln kann `trading_classify` (kind `rule`, der Regeltext wörtlich) schnell helfen – nur `decided` zählt, die harten Zahlen rechnest du selbst.

## 2. Positionsgröße (Long, mit Stop)
```
Risikobudget (USD) = min( Regelwerk: Risiko je Trade in % × Paper-Equity , Grenze maxRiskPerTradeUsd )
Stop-Abstand       = Einstieg − Stop   (> 0; sinnvoll: 1–2 ATR, nie enger als der Spread × 3)
Stückzahl          = abrunden( Risikobudget / Stop-Abstand )     (Krypto: auf die erlaubten Nachkommastellen)
Orderwert          = Stückzahl × Einstieg  → muss ≤ maxOrderValueUsd sein
Positionswert neu  = vorhandener Wert + Orderwert → muss ≤ maxPositionValueUsd sein
```
- Kosten und Slippage einrechnen (Aktien: Spread; Krypto: Gebühr + Spread) – das Chance-Risiko-Verhältnis nach Kosten nennen.
- Ist die Stückzahl < 1 (Aktien ohne Bruchstücke) → kein Trade.
- Rechenweg immer offenlegen (Tabelle), Zahlen mit Einheit.

## 3. Verboten (Beispiele, das Regelwerk gilt)
Nachkaufen im Minus, Stop weiter weg schieben, Trades ohne Stop, „Aufholen“ nach Verlusten, Einstieg entgegen dem Regelwerk-Zeitfenster, mehrere korrelierte Positionen über die Grenze, Leerverkäufe.

## 4. Abgleich mit den harten Grenzen
`alpaca_paper_account` → `limits`. Weicht das Regelwerk davon ab (z. B. Regelwerk 1 % = 1.000 USD, Grenze 50 USD), gilt **die strengere Zahl**; die Abweichung wird dem Owner gemeldet. Fehlt eine Grenze (`missingLimits`), öffnet Helena keine Position – melden.

## 5. Regelwerk ändern
Nur als Vorschlag: neue Fassung als Entwurf im Abschnitt „Vorschläge“ des Regelwerks mit Begründung (Review-Befund, Backtest), dann `request_approval`. Erst nach Freigabe die gültige Fassung ändern (Version + Datum im Front Matter, Änderung in „Änderungen“ protokollieren). Grenzen der Verbindung ändert nur der Owner.

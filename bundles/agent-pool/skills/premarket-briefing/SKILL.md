---
name: premarket-briefing
description: Pre-Market-Briefing und Session-Plan für DAX/XETRA und die US-Session – Handelstag und Uhrzeiten (MEZ/MESZ, Umstellungswochen), Termine, Nachrichten über Nacht, Gaps und Levels der Watchlist, erlaubte Setups aus freigegebenen Strategien mit vorgerechneter Positionsgröße. Nutze ihn für jede Tagesvorbereitung.
---

# Pre-Market-Briefing

Ein Briefing passt auf eine Bildschirmseite und beantwortet: **Handeln wir heute, was ist wichtig, welche Setups sind erlaubt, wo liegt das Risiko?**

## 1. Handelstag und Zeiten (immer zuerst)
- Zeitzone Europe/Berlin. XETRA 09:00–17:30. US-Session 15:30–22:00 – **außer** in den Umstellungswochen (USA stellt am 2. Sonntag im März und 1. Sonntag im November um, Europa am letzten Sonntag im März/Oktober): dann 14:30–21:00.
- Feiertage (XETRA, NYSE) prüfen. Kein Handelstag → eine Zeile „kein Handelstag“ und enden.
- Krypto hat keine Session; hier nur, wenn der Plan Krypto-Setups enthält.

## 2. Inhalt
1. **Termine heute** (Uhrzeit MEZ, Wichtigkeit): Notenbanken, Inflation, Arbeitsmarkt, Einkaufsmanager, Zahlen von Watchlist-Werten (catalyst-calendar). Quelle: Wochenkalender (1× täglich abrufen), Unternehmensseiten.
2. **Über Nacht:** Asien, Futures, wichtige Nachrichten (marktrecherche-und-news, kurz).
3. **Watchlist:** je Wert Vortagesschluss, vorbörslicher Kurs/Gap in %, Levels (Zone), ATR – als Tabelle. Daten über `alpaca_paper_market`/`alpaca_paper_bars`, wo verbunden.
4. **Erlaubte Setups:** nur aus Strategie-Versionen mit Status `paper` und Owner-Freigabe; je Setup: Strategie `[[id vX.Y]]`, Auslöser, Einstieg, Stop, Ziel, Positionsgröße nach regelwerk-und-positionsgroesse, Chance-Risiko.
5. **Regeln des Tages:** Tagesverlustgrenze, max. Trades, gesperrte Zeitfenster (z. B. 60 min vor Fed/EZB/Arbeitsmarkt/Inflation), keine Einstiege in den ersten 5 Minuten.
6. **Risiken/Unsicherheit:** was den Plan ungültig macht.

## 3. Regeln
- Kein Setup ohne freigegebene Strategie-Version. Keine „Ideen des Tages“ als Handelsauftrag.
- Unklarer Kalender oder fehlende Daten: im Briefing sagen, nicht raten.
- Der Plan geht als Hinweis an den Paper-Trader (Kommentar mit Link), nie als Order.

## 4. Ablage
Notiz aus der Vorlage „Pre-Market-Briefing“ in `Berichte/` (`<JJJJ-MM-TT> Pre-Market DE|US.md`), verlinkt mit Watchlist und Strategie-Versionen; Kurzfassung (5 Zeilen) als Kommentar; Hinweis „Keine Anlageberatung“.

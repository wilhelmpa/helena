---
name: trading-wissen-verknuepfen
description: Ablage und Verknüpfung im Trading-Wissen (Obsidian-kompatibler Vault) – Ordner unter Projects/<KEY>/Docs, Vorlagen aus Templates/Trading, Front Matter je Notiztyp, Wikilinks Trade → Strategie-Version → Backtest → Review → Research, Index-Notizen, Dateien als Anhänge, keine verwaisten Notizen. Nutze ihn bei jeder Notiz im Trading-Projekt.
---

# Trading-Wissen: ablegen und verknüpfen

Das Wissen ist ein Obsidian-kompatibler, git-versionierter Vault. Helena liest ihn (`search_knowledge`, `read_document`, `list_folder`, `backlinks`) und schreibt Notizen (`write_note`). **Jede Notiz hat Front Matter, entsteht aus einer Vorlage und ist verlinkt – keine verwaisten Notizen.**

## Ordner (unter `Projects/<KEY>/Docs/`)
| Ordner / Notiz | Inhalt | Dateiname |
|---|---|---|
| `Trading-Start.md` | Einstieg (MOC): Links auf alles Wichtige | fest |
| `Regelwerk.md` | das gültige Regelwerk | fest |
| `Strategie-Labor.md` | der Ablauf des Labors | fest |
| `Datenquellen.md` | Quellen, Lizenzen, Schlüssel-Status | fest |
| `Strategien/` | Übersicht `Trading-Strategien.md`; je Strategie ein Ordner mit Index-Notiz und einer Notiz je Version | `orb-spy/orb-spy.md`, `orb-spy/orb-spy v1.2.md` |
| `Backtests/` | Übersicht `Trading-Backtests.md`; Backtest-Berichte | `orb-spy v1.2 Backtest 2026-10-01.md` |
| `Journal/<JJJJ>/` | Übersicht `Journal/Trading-Journal.md`; ein Eintrag je Trade | `2026-10-01 SPY orb-spy v1.2.md` |
| `Berichte/` | Übersicht `Trading-Berichte.md`; Pre-Market-Briefings, Paper-Tagesberichte | `2026-10-01 Paper-Tagesbericht.md` |
| `Reviews/` | Übersicht `Trading-Reviews.md`; Wochen- und Monatsreviews | `2026-KW40 Wochenreview.md`, `2026-10 Monatsreview.md` |
| `Research/` | Übersicht `Trading-Research.md`; Analysen, Nachrichtenlagen, Thesen | `2026-10-01 Kalix Zahlen Q3.md` |
| `Märkte/` | `Trading-Watchlist.md`, Marktnotizen je Instrument | `SPY.md` |
| `Steuern/` | Dokumentation Kapitalerträge/Krypto | `Kapitalerträge 2026.md` |

Notiznamen sind im ganzen Projekt **eindeutig** (Strategie-ID und Version im Namen), damit `[[Name]]` immer genau eine Notiz trifft.

## Vorlagen (`Templates/Trading/`)
Analyse, Strategie, Backtest, Trade, Tagesbericht, Wochenreview, Monatsreview, Pre-Market-Briefing, Watchlist. Vorgehen: Vorlage mit `read_document` lesen, `{{title}}`/`{{date}}` ersetzen, ausfüllen, mit `write_note` anlegen. Leere Abschnitte bleiben mit „–“ stehen, damit man sieht, dass nichts fehlt.

## Front Matter (Pflichtfelder)
- alle: `typ`, `datum`, `tags`
- Strategie: `strategie`, `version`, `status` (idee | entwurf | backtest | freigabe-angefragt | paper | pausiert | ausgemustert), `markt`, `zeitrahmen`, `instrumente`, `vorgaenger`, `backtest`, `freigabe`
- Backtest: `strategie`, `version`, `zeitraum_is`, `zeitraum_oos`, `daten`, `kosten`, `trades`, `ergebnis` (bestanden | nicht-bestanden)
- Trade: `trade_id` (clientOrderId), `strategie`, `version`, `markt`, `symbol`, `seite`, `menge`, `einstieg_geplant`, `stop`, `risiko_usd`, `order_id`, `status`, `konto: paper`; nach dem Schluss `ausstieg`, `ergebnis_usd`, `ergebnis_r`, `regel_eingehalten`
- Review: `zeitraum`, `strategien`, `kennzahlen`

## Verknüpfen – Pflicht
1. **Trade → Strategie-Version** (`[[orb-spy v1.2]]`) und → Tagesbericht.
2. **Strategie-Version → Backtest(s), Vorgänger-Version, Research-Notizen**, aus denen die Idee stammt.
3. **Backtest → Strategie-Version** und → Ergebnisdateien.
4. **Review → alle betrachteten Strategie-Versionen und Trades** (Liste), → nächste Verbesserungs-Version.
5. **Index-Notiz der Strategie** (`Strategien/<id>/<id>.md`) listet jede neue Version, jeden Backtest, jedes Review – beim Anlegen einer dieser Notizen die Index-Notiz mit aktualisieren (`read_document` → `sha256` → `write_note` mit `expectedSha`).
6. Aufgaben mit `[[KEY-n]]` verlinken; Notizen aus Aufgaben-Kommentaren verlinken.
7. Vor dem Abschluss mit `backlinks` prüfen: Hat die neue Notiz mindestens einen eingehenden Link (Index, Tagesbericht, Review)? Wenn nicht, verlinken.

## Dateien
- Backtest-Ergebnisse (CSV, PNG) mit `add_attachment` an die Backtest-Aufgabe hängen; sie liegen dann unter `Projects/<KEY>/Files/Tasks/<KEY>-n/`. In der Notiz mit `![[<dateiname>.png]]` bzw. `[[<dateiname>.csv]]` einbinden. Dateinamen eindeutig: `<id>-v<version>-<art>.<endung>`.
- Diagramme für Menschen zusätzlich mit `create_chart`.
- Skripte und Rohdaten gehören in den Arbeitsbereich (Bereich strategie-labor), nicht ins Wissen.

## Board „Strategie-Labor“
Das Notizen-Board zeigt die Pipeline. Stickers nie löschen; neue Strategien als Sticker mit Link auf ihre Index-Notiz in die passende Spalte.

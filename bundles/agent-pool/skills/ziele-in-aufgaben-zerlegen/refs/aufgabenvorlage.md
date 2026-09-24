# Vorlage: Aufgabenbeschreibung

```markdown
## Ziel
<Wer> kann <was>, damit <Nutzen>.

## Kontext
- Ausgangsaufgabe: KEY-n
- Relevante Dateien/Seiten: …
- Entscheidungen/Notizen: [[…]]

## Akzeptanzkriterien
1. **Gegeben** <Ausgangslage>, **wenn** <Aktion>, **dann** <beobachtbares Ergebnis>.
2. **Gegeben** <leerer Zustand / keine Rechte / Fehler>, **wenn** …, **dann** <verständliche Meldung, nichts kaputt>.
3. …

## Nicht Teil davon
- …

## Definition of Done
- [ ] Akzeptanzkriterien nachweislich erfüllt (Test, Screenshot oder Log)
- [ ] Automatische Tests für neue Logik, bestehende Tests grün
- [ ] Review durchgeführt (Code-Reviewer), Befunde erledigt
- [ ] Texte in allen Sprachdateien; Doku/Changelog angepasst, wenn nutzersichtbar
- [ ] Bei UI: Screenshots 1440 und 390 px, Konsole sauber
- [ ] Nichts live ohne Freigabe (Deploy, Veröffentlichung, Versand)

## Schätzung
<Punkte> – Begründung/Risiko: …
```

## Gute und schlechte Kriterien
| Schlecht | Gut |
|---|---|
| „Export funktioniert" | „Wenn ich auf *Exportieren* klicke, lädt eine XRechnung-XML herunter, die der KoSIT-Validator ohne Fehler annimmt." |
| „Schnell" | „Die Liste mit 1.000 Einträgen lädt in unter 1 s (lokal gemessen)." |
| „Fehler behandeln" | „Bei fehlender USt-IdNr. zeigt das Formular *USt-IdNr. fehlt* am Feld und speichert nicht." |

## Beispiel-Schnitt
Ziel: „Der Owner sieht alle offenen Rechnungen eines Monats mit Fälligkeit."
1. Spike: Wo liegen Rechnungsdaten heute? (1 P, Ergebnis Notiz)
2. Liste offener Rechnungen mit Betrag und Fälligkeit – nur lesen (3 P)
3. Filter nach Monat und Status (2 P)
4. Hinweis bei überfälligen Rechnungen (1 P)
5. Doku + Übersetzungen (1 P)
Abhängigkeiten: 1 blockiert 2; 2 blockiert 3 und 4.

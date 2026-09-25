---
name: ziele-in-aufgaben-zerlegen
description: Ein Ziel, eine Idee oder ein Feature in Helena-Aufgaben zerlegen – mit Ergebnis, Akzeptanzkriterien (Gegeben/Wenn/Dann), Schätzung, Priorität, Abhängigkeiten und Reihenfolge, verknüpft mit dem Helena-Ziel, dem sie dienen. Nutze ihn, bevor du einen Plan, ein Backlog, eine Spezifikation oder Unteraufgaben anlegst.
---

# Ziele in Aufgaben zerlegen (Helena)

Ergebnis ist ein Plan, den ein Mensch oder ein Agent **ohne Rückfrage** abarbeiten kann: jede Aufgabe hat ein prüfbares Ergebnis, Kriterien, eine Schätzung und ihre Abhängigkeiten.

## 1. Verstehen, bevor du zerlegst
- Lies die Aufgabe, ihre Kommentare, verlinkte Aufgaben (`get_issue`, `list_issue_activity`), die Projektanweisungen und das Projektwissen (`search_knowledge`, Ordner `Projects/<KEY>`).
- Geht es um ein **Helena-Ziel** (Organisation → Ziele; die aktiven deiner Projekte stehen unter „## Goals“ in deinen Anweisungen)? Lies es mit `get_goal`: Beschreibung, Zieldatum, übergeordnete Ziele, was schon verknüpft ist und die letzten Notizen. Ohne Ziel-ID: `list_goals`. Erfinde keine Ziele; ein neues Ziel legt der Owner an.
- Schreib das Ziel in **einem Satz** aus Sicht des Nutzers: „<Wer> kann <was>, damit <Nutzen>."
- Halte fest: Nicht-Ziele (was ausdrücklich nicht dazugehört), Randbedingungen (Termin, Budget, Technik, Recht), Annahmen.
- Fehlt eine Entscheidung, die den Schnitt ändert (Umfang, Zielgruppe, Priorität)? Dann **eine** Frage per `mark_issue_blocked` statt raten.

## 2. Schneiden
- **Vertikal** schneiden: jede Aufgabe liefert etwas Nutzbares oder Prüfbares (Durchstich durch UI, API, Daten), nicht „Backend fertig" / „Frontend fertig".
- Größe: eine Aufgabe passt in **einen Arbeitstag** eines Agenten oder Menschen (≈ 1–3 Punkte). Größer → weiter zerlegen oder als Elternaufgabe mit Unteraufgaben (`parentId`).
- INVEST-Test pro Aufgabe: unabhängig, verhandelbar, wertvoll, schätzbar, klein, testbar.
- Risiko zuerst: Unklares als kurzer **Spike** (zeitlich begrenzt, Ergebnis = Entscheidung + Notiz), bevor darauf aufgebaut wird.
- Querschnitt nicht vergessen: Tests, Migration, Doku, Übersetzungen (alle Sprachdateien), Rechte/Freigaben, Monitoring, Aufräumen.

## 3. Jede Aufgabe beschreiben
Titel im Imperativ und konkret („Rechnungen als XRechnung exportieren"), Beschreibung nach `refs/aufgabenvorlage.md`:
- **Ziel** (ein Satz) und **Kontext** (Links, Dateien, Entscheidungen)
- **Akzeptanzkriterien** als Gegeben/Wenn/Dann, messbar, inklusive Fehler- und Leerfall
- **Nicht Teil davon**
- **Definition of Done** (Tests grün, Review, Doku, i18n, Screenshots bei UI)

## 4. Schätzen und priorisieren
- Story Points (Fibonacci 1, 2, 3, 5, 8) relativ zu einer bekannten Referenzaufgabe; 8 heißt „zerlegen". Zeitschätzung in Minuten nur, wenn verlangt.
- Unsicherheit offen angeben („3, Risiko hoch: API unbekannt") statt Scheinpräzision.
- Priorität `urgent`/`high`/`medium`/`low`. Zum Abwägen RICE (Reichweite × Wirkung × Zuversicht ÷ Aufwand) oder Wert/Aufwand-Matrix; Begründung in einem Satz.
- Reihenfolge nach Abhängigkeiten und Risiko, dann Wert.

## 5. In Helena anlegen
1. `get_project` für Spalten (Status), Labels, Typen; vorhandene Aufgaben prüfen (`search_issues`), **keine Dubletten**.
2. Elternaufgabe für das Ziel, Unteraufgaben mit `create_issue` und `parentId`; Schätzung `estimatePoints`, Priorität, ggf. `dueDate`, Labels, Zyklus (`cycleId`) oder Initiative (`initiativeId`).
   **Dient die Arbeit einem Helena-Ziel, gib jeder neuen Aufgabe `goalId` mit** (die Elternaufgabe und die Unteraufgaben): Dann zählt das Ziel sie in seinem Fortschritt, und der Owner sieht auf der Zielseite, wer woran arbeitet. Bestehende Aufgaben verknüpfst du mit `link_issue_to_goal`.
3. Abhängigkeiten mit `link_issues` (`blocks`), Verwandtes mit `relates`.
4. Kleinteilige Schritte innerhalb einer Aufgabe als Checkliste (`create_checklist`, `create_checklist_item`), nicht als eigene Aufgaben.
5. **Nicht selbst delegieren oder zuweisen**, außer die Aufgabe verlangt es: Wer was macht, entscheidet der Koordinator des Projekts. Jede Delegation an einen Agenten startet einen Lauf und kostet Tokens.
6. Neue Aufgaben in die Eingangs-/Backlog-Spalte, nicht direkt in „In Arbeit".

## 6. Bericht
Kommentar an der Ausgangsaufgabe:
```
Plan: <Ziel in einem Satz>
Aufgaben: <KEY-n Titel (Punkte, Priorität)> … – Summe <x> Punkte
Reihenfolge / kritischer Pfad: KEY-a → KEY-b → KEY-c
Risiken und Annahmen: …
Offene Entscheidungen: … (braucht dich)
```
Ging es um ein Helena-Ziel, zusätzlich eine kurze Notiz am Ziel mit `add_goal_note`: welche Aufgaben es jetzt verfolgen und was als Nächstes kommt. Ist das Ziel erreicht oder ruht es, schlag den Status dort mit `proposedStatus` vor (`achieved`, `paused`) – der Owner bestätigt ihn; ändere ihn nie selbst.

Bei größeren Vorhaben zusätzlich eine Notiz im Projektwissen (`write_note`, `Projects/<KEY>/Docs/Plaene/<Thema>.md`) mit Ziel, Nicht-Zielen, Schnitt und Begründung; in der Aufgabe mit `[[Notizname]]` verlinken.

---
name: review-ablauf
description: Wie ein Review in Helena abläuft – nur lesen und prüfen, nie pushen oder mergen; Diff eingrenzen, Tests selbst laufen lassen, Befunde nach Schwere mit Datei und Zeile, Fixes gegen die Ursache prüfen, Ergebnis als Kommentar. Nutze ihn für jedes Code-, Security- oder Fix-Review.
---

# Review-Ablauf

Du bist **Prüfer, nicht Autor**. Du änderst keinen Code, der geprüft wird, pushst nichts, mergst nichts, schließt keine Aufgabe und deployst nichts. Du lieferst Befunde, die jemand anderes umsetzt. (Einen Test, der einen Befund belegt, darfst du lokal schreiben und laufen lassen – committe ihn nicht in den geprüften Branch.)

## 1. Umfang klären
- Was genau wird geprüft? Branch gegen Basis (`git fetch`, `git log --oneline <basis>..<branch>`, `git diff <basis>...<branch> --stat`), einzelne Commits oder Dateien.
- Wozu dient die Änderung? Aufgabe, Akzeptanzkriterien, verlinkte Befunde lesen (`get_issue`, Kommentare). Ohne Ziel kein Review: dann `mark_issue_blocked` mit der Frage, was geprüft werden soll.
- Große Diffs (> ~800 Zeilen): nach Risiko ordnen (Rechte, Geld, Daten, Migrationen, öffentliche Schnittstellen zuerst), sagen, was du tief und was nur überflogen hast.

## 2. Prüfen
- **Den ganzen Kontext lesen**, nicht nur die geänderten Zeilen: Aufrufer, Tests, Schema, Konfiguration.
- **Selbst ausführen**: Typecheck, Linter, betroffene Tests. Ergebnis mit Befehl und Ausgabe-Auszug belegen. „Sollte funktionieren" ist kein Befund.
- Checklisten: `code-review`/`find-bugs`-Skills für Korrektheit und Sicherheit, `code-review-and-quality` für Architektur und Lesbarkeit. Bei Security-relevantem Diff zusätzlich `owasp-security`/`security-and-hardening`.
- Projektregeln: im Helena-Repo zusätzlich `refs/helena-repo-regeln.md`.
- Nichts erfinden: Wenn du nichts Wesentliches findest, sag das – mit der Liste dessen, was du geprüft hast.

## 3. Schwere
| Stufe | Bedeutung | Beispiel |
|---|---|---|
| **Blocker** | darf so nicht rein: falsch, unsicher, Datenverlust, bricht Bestehendes | fehlende Rechteprüfung, SQL-Injection, Migration ohne Rückweg |
| **Wichtig** | sollte vor dem Merge behoben werden | fehlender Test für neue Logik, Fehlerfall unbehandelt, Race Condition |
| **Hinweis** | Verbesserung, kann später | Benennung, Duplikat, Vereinfachung |
| **Frage** | unklar, Autor soll erklären | „Warum wird hier nicht … ?" |

Jeder Befund: **Datei:Zeile**, was falsch ist, **warum** (Folge), Vorschlag (kurz, ggf. Code-Skizze), Beleg (Testausgabe, Zitat).

## 4. Fix-Review (wenn ein Befund behoben sein soll)
1. Ursache des ursprünglichen Fehlers in einem Satz benennen.
2. Behebt der Diff **diese Ursache** oder nur das Symptom? (z. B. Nullcheck statt Grund für den Null-Wert)
3. Gibt es einen Test, der **ohne** den Fix fehlschlägt und **mit** ihm besteht? Wenn möglich selbst prüfen (Fix lokal zurücknehmen, Test laufen lassen, wiederherstellen).
4. Neue Risiken durch den Fix in den geänderten Zeilen?
5. Urteil: behoben / teilweise / nicht behoben – mit Begründung.

## 5. Ergebnis
Als Kommentar in der Aufgabe (`add_comment`), Deutsch:
```
## Review <Branch/PR> – <Urteil: freigeben | Änderungen nötig | Rückfragen>
Geprüft: <Commits/Dateien>, Tests: <Befehl> → <Ergebnis>

### Blocker
1. `pfad/datei.ts:42` – <Befund>. Folge: … Vorschlag: …

### Wichtig
…
### Hinweise
…
### Fragen
…
### Gut gelöst
- …
Nicht geprüft: <was und warum>
```
Freigeben heißt: keine Blocker, keine offenen „Wichtig"-Punkte. Den Merge macht ein anderer.

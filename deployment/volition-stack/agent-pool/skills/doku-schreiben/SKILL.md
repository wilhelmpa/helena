---
name: doku-schreiben
description: Technische Dokumentation auf Deutsch und Englisch schreiben und pflegen – Dokumentart wählen (Anleitung, How-to, Referenz, Erklärung), gegen den echten Code prüfen, Begriffe konsistent halten, DE/EN synchron, Changelog und Release Notes. Nutze ihn für READMEs, Handbücher, Einrichtungsanleitungen, API-Doku, Changelogs und Wissensnotizen.
---

# Doku schreiben (DE/EN)

Doku ist nur gut, wenn sie **stimmt**. Jede Aussage über Code, Befehle, Pfade, Optionen oder Oberflächen prüfst du gegen den aktuellen Stand (Code lesen, Befehl ausführen, Seite ansehen), bevor sie in die Doku kommt.

## 1. Dokumentart wählen (eine pro Seite)
| Art | Frage des Lesers | Form |
|---|---|---|
| **Anleitung** (Tutorial) | „Wie lerne ich das?" | ein geführter Weg von null zum ersten Erfolg, jeder Schritt klappt garantiert |
| **How-to** | „Wie erledige ich X?" | Ziel im Titel, nummerierte Schritte, Voraussetzungen oben, kein Grundlagenexkurs |
| **Referenz** | „Was genau ist/tut Y?" | vollständig, knapp, gleich aufgebaut (Tabellen: Name, Typ, Standard, Bedeutung) |
| **Erklärung** | „Warum ist das so?" | Hintergrund, Entscheidungen, Alternativen, Zusammenhänge |

Mischformen trennen: Eine How-to-Seite verlinkt die Erklärung, statt sie zu enthalten.

## 2. Schreiben
- Leser und Vorwissen benennen (Owner, Entwickler, Endnutzer). Erster Absatz: worum es geht und für wen.
- Kurze Sätze, aktiv, Imperativ in Schritten („Öffne …", „Run …"). Ein Schritt = eine Handlung + erwartetes Ergebnis.
- Befehle und Code in Codeblöcken mit Sprache; Platzhalter als `<name>` und darunter erklärt. Nichts, was Secrets enthält – Beispiele mit `itp_…`/`sk-…`-Platzhaltern.
- UI-Beschriftungen **genau so**, wie sie in der Oberfläche stehen (Deutsch: „Agentenpool", „Spezialisten aus Vorlage hinzufügen").
- Produktname **Helena** – nie „Plan"/„It's a Plan", kein „by Volition". Volition ist nur der Firmenname (volition.one).
- Screenshots nur, wenn sie etwas zeigen, das Text nicht kann; mit Datum/Version im Dateinamen.

## 3. Deutsch und Englisch
- Deutsch: Du-Form wie in der Oberfläche von Helena; neutrale, klare Sprache; Fachwörter, die im Team üblich sind, nicht zwanghaft eindeutschen (Branch, Commit, Deploy), aber einheitlich.
- Englisch: plain English, US-Schreibweise, gleiche Struktur und Überschriften wie die deutsche Fassung.
- **Parität**: Beide Fassungen haben dieselben Abschnitte, Befehle, Beispiele und Stand-Datum. Ändert sich eine, änderst du die andere mit – oder markierst sie sichtbar als veraltet.
- Begriffe in einer kleinen Tabelle pflegen (Glossar im Projektwissen), damit „Vorlage/Template", „Kopie/Copy", „Freigabe/Approval" überall gleich übersetzt sind.

## 4. README (Kurzform)
Name und ein Satz, was es ist → Schnellstart (kleinster funktionierender Weg) → Installation/Voraussetzungen → Nutzung mit echtem Beispiel → Konfiguration (Tabelle) → Entwicklung/Tests → Lizenz/Herkunft. Alles, was im README steht, muss mit dem aktuellen Code laufen. Details: Skill `good-readme`.

## 5. Changelog und Release Notes
- Changelog nach „Keep a Changelog": Abschnitte Hinzugefügt / Geändert / Veraltet / Entfernt / Behoben / Sicherheit, neueste Version oben, Datum ISO (2026-09-24). Details: Skill `changelog-automation`.
- Einträge aus Sicht des Nutzers („Vorlagen zeigen jetzt ihr Modell"), nicht Commit-Texte kopieren. Breaking Changes mit Upgrade-Schritt.
- Release Notes für den Owner: 3–5 wichtigste Punkte zuerst, dann Details.

## 6. Prüfen vor Abgabe
- [ ] Jeder Befehl ausgeführt oder gegen Code geprüft; jeder Link erreichbar
- [ ] Jeder Pfad, jede Option, jeder UI-Text existiert genau so
- [ ] Keine Secrets, keine internen Hostnamen/Passwörter, keine personenbezogenen Daten
- [ ] DE/EN gleich; Stand-Datum gesetzt
- [ ] Rechtschreibung (Duden-Regeln / US English)

## 7. Ablage
- Doku, die zum Code gehört (README, `docs/`), im Repo auf einem eigenen Branch; Veröffentlichen/Mergen nach Review und Freigabe.
- Wissen und Anleitungen für den Owner als Notiz (`write_note`, `Projects/<KEY>/Docs/…`), in der Aufgabe verlinkt.

# Entscheidung: Standarddaten in der Sprache der Person (Status, Aufgabentypen, Ansichten)

Datum: 2026-09-24 · Branch: `hub/default-data-i18n` · Status: entschieden

## Der Auftrag

Im E2E-Test des Owners legte ein neues Projekt in der deutschen Oberfläche englische Daten an: die Status Backlog, Todo, In Progress, Review, Done, Canceled, die Aufgabentypen der Vorlage (Task, Feature, Bug …) und die Ansichten Kanban und List. Der Dialog zeigte vorher „1 Aufgabentyp wird erstellt: Task“.

Ziel:
- Neue Projekte bekommen diese Namen in der Oberflächensprache der Person, die sie anlegt.
- Die Vorschau im Dialog zeigt genau die Namen, die entstehen.
- Die Namen bleiben Daten: Man kann sie danach frei umbenennen.
- Statustypen und Farben bleiben gleich.
- Alle 10 Sprachen.
- Ein Katalog, den API und Web gemeinsam nutzen, statt Kopien in zwei Apps.

## Was dazugehört (Bestandsaufnahme)

Helena legt für eine Person diese sichtbaren Daten an:

| Daten | Wo | Anmerkung |
|---|---|---|
| 6 Standard-Status | `createProject`, `copyProject` (wenn Status nicht kopiert werden) | Der Agenten-Team-Schritt sucht den Status „Review“ **per Name**, ebenso die eingebaute Workflow-Vorlage (`set_status: 'Review'`). |
| Aufgabentypen je Vorlage (10 Vorlagen, 32 Typen) | `createProject` | Die Web-Vorschau hatte eine eigene Kopie der Liste. |
| Ansichten Kanban und List | `ensureDefaultProjectViews` (Anlegen, Kopie, Projektvorlage, „Standardansichten ergänzen“) | Sie werden **per Name** wiedererkannt, sonst entstünden sie doppelt. |
| Anzeigename des Koordinators „Hermes VOL Coordinator“ | `createHermesProjectCoordinator`, Bootstrap | Der Handle `hermes-vol-coordinator` bleibt in jeder Sprache gleich. |
| Standardrolle „Member“ eines neuen Teams | API `createTeam`/`insertOwnedTeam`, Registrierungs-Hook in `@repo/auth` | Die Oberfläche zeigt den gespeicherten Namen. |
| Label „Blocked“ und der Satz „Blocked, needs input:“ | `markIssueBlocked` | Das Label wird beim ersten Mal angelegt und dann **per Name** wiederverwendet. |

Die Texte der Oberfläche selbst (next-intl) sind nicht betroffen. Nicht dazu gehören auch die Vault-Ordner (`Docs`, `Files` …), denn das sind Pfade.

## Kandidaten

| | Was es ist | Passung |
|---|---|---|
| **Übersetzungsdateien im gemeinsamen Paket `@helena/locales`** (gewählt) | `packages/locales/messages/<locale>/defaults.json` im selben Format wie die Web-Nachrichten (JSON je Sprache, Englisch als Quelle); ein typisiertes Modul `@helena/locales/defaults` liest alle Sprachen statisch ein | API und Web nutzen `@helena/locales` bereits. Eine neue Sprache ist eine neue Datei, die Übersetzer im gewohnten Format pflegen (passt zum Erweiterungspunkt „Sprachen“ in §3a). TypeScript prüft, dass jede Sprache jeden Schlüssel hat (`Record<Locale, typeof en>`), ein Test prüft dasselbe an den Dateien. Keine neue Abhängigkeit. |
| TS-Literal `Record<Locale, string>` je Name | Daten als Code | Die Vollständigkeit wird ebenso geprüft. Übersetzer müssten dafür aber Code bearbeiten, und das Format wiche vom Rest ab. |
| In die Web-Nachrichten legen (`apps/web/messages`) und von der API aus lesen | ein Katalog | Dann hinge die API von Dateien der Web-App ab. |
| i18n-Schlüssel statt Namen speichern (`{ i18n: 'defaults.states.todo' }`, wie `LocalizedText` im SDK) und erst beim Anzeigen übersetzen | Namen folgen der Sprache der Betrachtenden | Abgelehnt: Die Namen sind Daten der Person. Sie werden umbenannt, von Agenten gelesen, in Workflows und Webhooks verwendet und müssen überall gleich lauten. Ein Schlüssel in der Datenbank bräuchte an jeder Stelle (API, MCP, Agenten, Exporte) eine Übersetzung. |
| Übersetzungstabelle in der Datenbank | wie oben | Abgelehnt, derselbe Grund, dazu eine Migration. |
| `intl-messageformat` (BSD-3) für Platzhalter | ICU-Formatierung | Nicht nötig: Es gibt nur den Platzhalter `{key}` im Koordinator-Namen, ohne Plural- oder Genusregeln. |

Die Einträge von `defaults.json` haben die Form `{ [locale]: string }`, also die eines `LocalizedText` aus `@helena/sdk`. Kommt später eine Registry für Projektvorlagen (Erweiterungspunkt „Vorlagen und Pakete“), gehen Struktur und Namen unverändert dorthin.

## Entscheidung

1. **Ein Katalog: `@helena/locales/defaults`.**
   - Die Namen liegen in `packages/locales/messages/<locale>/defaults.json`.
   - Die Struktur ist Code und in jeder Sprache gleich: welche Status mit welchem Typ und welcher Farbe, welche Vorlage welche Typen anlegt, welche Ansichten es gibt.
   - Hilfsfunktionen: `defaultStates(locale)`, `presetIssueTypes(preset, locale)`, `coordinatorName(key, locale)`, `defaultRoleName`, `blockedLabelName`/`blockedCommentPrefix`, `defaultViewKey(name)` und `findState(states, name)`.
2. **Welche Sprache.**
   - **Neues Projekt oder Kopie:** zuerst `locale` aus der Anfrage (neues optionales Feld von `create_project`/`copy_project`), dann die Oberflächensprache des Owners (`user_preference.locale`), dann die Browsersprache der Anfrage (so machen es auch die Kontoeinstellungen, solange nichts gespeichert ist), dann Englisch.
   - Eine Instanz-Standardsprache gibt es nicht. Käme sie, gehörte sie als eine Zeile in `preferredLocale`.
   - Legt ein Agent über MCP ein Projekt für seinen Menschen an, gilt die Sprache dieses Menschen.
   - **Neues Team:** Sprache des Owners; bei der Registrierung die Browsersprache der Anmeldung.
   - **Was Helena später in ein bestehendes Projekt legt** (eine fehlende Standardansicht, das Label „Blockiert“): die Sprache des Projekt-Owners (`projectLocale`).
3. **Vorschau = Ergebnis.** Der Dialog liest die Typen aus demselben Katalog in der angezeigten Sprache (`useLocale()`) und schickt genau diese Sprache als `locale` mit. Damit entsteht, was die Vorschau zeigt, auch wenn Cookie und gespeicherte Einstellung kurz auseinanderliegen. Die Web-Kopie `utils/projectPresets.ts` ist gelöscht.
4. **Namen, die als Bezug dienen, gelten sprachübergreifend.** Ein Workflow, der „Review“ oder „Done“ sagt, findet in einem deutschen Projekt „In Prüfung“ bzw. „Erledigt“ (`findState`).
   - Ein Status mit genau dem Namen hat Vorrang.
   - Ein vom Menschen umbenannter Status wird nur unter seinem neuen Namen gefunden.
   - Das gilt für: den Review-Schritt des Agenten-Teams, `set_status`, die Status-Bedingung, den Auslöser `status_changed`, die Prüfung eines Workflows gegen das Projekt und das Anwenden einer Projektvorlage (keine doppelten Status oder Ansichten, wenn eine englische Vorlage auf ein deutsches Projekt trifft).
   - Standardansichten und das Label „Blocked“ werden ebenfalls unter ihrem Namen in jeder Sprache wiedererkannt.
5. **Bestehende Daten werden nicht still umbenannt.** Sie gehören dem Owner. `apps/api/src/scripts/localize-default-names.ts` benennt auf Wunsch nur Namen um, die noch **genau** der englische Standard sind. Es läuft standardmäßig als Probelauf, schreibt erst mit `--apply` (in einer Transaktion), überspringt Namenskollisionen und ist idempotent.

## Wortwahl Deutsch

- **Status:** Backlog, Zu erledigen, In Arbeit, In Prüfung, Erledigt, Abgebrochen. Das sind die Wörter, die die Oberfläche bei Initiativen schon verwendet (`initiatives.stateGroups`). „In Prüfung“ passt zu „In Arbeit“.
- **Ansichten:** Board und Liste. „Board“ ist das Wort der Oberfläche für das Kanban-Layout.
- **Koordinator:** „Hermes-Koordinator VOL“.
- **Rolle:** Mitglied.
- **Label:** Blockiert.
- **Typen:** Aufgabe, Feature, Bug, Technische Schulden, Recherche, Epic, Feedback, Artikel, Video, Social-Media-Beitrag, Idee, Review, Kampagne, Landingpage, Asset, E-Mail, Screen, Komponente, Lead, Deal, Nachfassen, Kunde, Anfrage, Prozess, Einkauf, Wartung, Störung, Frage, Änderung, Bewerbung, Onboarding, Richtlinie. Wo Teams im Deutschen den englischen Begriff benutzen (Feature, Bug, Epic, Lead, Deal, Asset, Screen), bleibt er.

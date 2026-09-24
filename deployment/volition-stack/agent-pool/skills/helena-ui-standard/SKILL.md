---
name: helena-ui-standard
description: Der verbindliche UI-Standard von Helena (Kopfzeile, Typografie, Flächen, Buttons, Mobil, Klickbarkeit) und wie man eine Seite dagegen prüft. Nutze ihn, bevor du eine Helena-Oberfläche entwirfst, änderst oder reviewst, und für jedes Design-Review mit Screenshots.
---

# Helena UI-Standard

Die Regeln des Owners, an einer Stelle. Jede Seite folgt ihnen; eine Seite, die es nicht tut, ist ein Fehler.
Referenz im Code: `docs/volition/ui-standard.md` (Helena-Repo). Die **Seitenleiste ist die Referenz** für Schrift, Größe und Flächen.

## Die Regeln

### Eine Zeile oben
- Die App-Kopfzeile ist die einzige Kopfzeile: Seitenleisten-Schalter | Breadcrumb (Projekt › Seite) | **Toolbar der Seite** | Werkzeuge der App.
- Eine Seite legt alles, was sie anbietet, in **eine** `<PageToolbar>` (`components/layout/PageToolbar.tsx`): `PageTabs` (Ansichten), `PageToolbarSpacer`, `PageSearch` (Filterfeld), eigene kompakte Controls (`PAGE_CONTROL_CLASS`), `PageActions` (Icon-Aktionen + höchstens eine gefüllte Primäraktion).
- Keine zweite oder dritte Zeile mit Tabs, Filtern oder Buttons unter der Kopfzeile. Keine Intro-/Beschreibungszeile unter der Kopfzeile.
- Wird es eng, faltet sich die Toolbar selbst (Suche → Icon, Aktionen → „…", Primär → Icon, Tabs → Dropdown). Unter 1024 px wandert sie in eine eigene 44-px-Zeile unter der Kopfzeile – auf jeder Seite gleich.

### Schrift (Inter)
| Größe | Tailwind | Wofür |
|---|---|---|
| 13 px | `text-sm` | Zeilen, Zellen, Controls, Fließtext |
| 12 px | `text-xs` | Labels, Meta, Badges |
| 14 px | `text-md` | Abschnitts-, Panel- und Dialogtitel |
| 16 px | `text-base` | nur der **eine** Seitentitel (Begrüßung auf Start, Aufgabentitel) |

Keine anderen Größen, keine `text-[Npx]`, keine eigenen Schriftarten.

### Flächen
- Kästen (Karten, Listengruppen, Board-Spalten) nutzen die Fläche der Seitenleiste (`bg-card`); Hover und Auswahl den Akzent der Seitenleiste (`hover:bg-accent`, `bg-accent`). Ein Material überall.
- Controls 32 px hoch, Icons 16 px, `rounded-md`. Nur Popover, Menüs und Dialoge schweben mit Schatten.
- Farben nur über Tokens (`--status-*`, `--brand-subtle`, `bg-card`, `text-muted-foreground` …), nie roh (`#hex`, `rgb()`, `amber-500`). Hell **und** dunkel müssen stimmen.

### Buttons
- Höchstens **ein** gefüllter (dunkler) Button pro Seite: die Primäraktion, in der Toolbar.
- „Hinzufügen"-Buttons in Abschnitten sind `variant="outline" size="sm"` oder ghost.

### Klickbarkeit
- Was klickbar aussieht, ist klickbar; was nicht klickbar ist, bekommt **keinen** Hover, keinen Pointer, keinen Button-Look.
- Jede Zeile, die zu etwas führt, führt beim Klick dorthin (ganze Zeile, nicht nur der Name).

### Mobil (390 px)
- Kopfzeile = Schalter, Seitenname, Werkzeuge; Seiten-Toolbar in der Zeile darunter.
- Kein horizontales Scrollen der Seite. Touch-Ziele ≥ 40 px.

### Sprache und Namen
- Alle Texte über i18n (`next-intl`), in **allen** Sprachdateien (`apps/web/messages/<locale>/`), nicht hart im Code.
- Produktname ist **Helena**, nie „Plan" oder „It's a Plan" und ohne „by Volition" (einzige Ausnahme: AGPL-Hinweis auf der About-Seite, in LICENSE/NOTICE/README).
- Im LAN läuft Helena über http: Zwischenablage und IDs nur über `copyText`/`uuid` aus `@/utils/clipboard` und `@/utils/uuid`.

## Vorgehen beim Design-Review

1. **Screenshots** der Seite bei 1440×900 und 390×844 (mobil), hell und dunkel, jeweils Ausgangszustand und die wichtigsten Zustände (leer, voll, Fehler, Dialog offen).
2. **Konsole prüfen**: Eine Seite mit Fehlern oder Warnungen in der Browser-Konsole ist nicht fertig. „Nicht klickbar" hat oft eine Konsolen-Ursache (z. B. „Maximum update depth exceeded").
3. **Jede Regel oben durchgehen** (siehe `refs/review-checkliste.md`) und jeden Verstoß mit Ort notieren: Seite, Element, Screenshot-Ausschnitt, ggf. Datei/Komponente.
4. **Klicktest**: jedes Element, das klickbar aussieht, anklicken; jede Zeile, die zu etwas führen sollte, anklicken; Tastatur (Tab, Enter, Esc) in Dialogen.
5. **Barrierefreiheit kurz**: Kontrast (WCAG AA 4,5:1 für Text), Fokus sichtbar, Icon-Buttons mit `aria-label`, Formularfelder mit Label.
6. **Bericht** (siehe unten). Keine eigenen Stile vorschlagen, sondern den vorhandenen Baustein nennen (`PageToolbar`, `EntityCard`, `SettingsSection`, `EmptyState`, `StatusBadge`, `UnsavedChangesBar` …).

## Bericht (Deutsch)

```
## Design-Review: <Seite> (<Datum>)
Screenshots: <Pfade>
Konsole: sauber | <Fehler>

### Muss (bricht den Standard)
1. <Regel> – <wo> – <was stattdessen (Baustein/Token)>

### Sollte
…

### Gut gelöst
…
```

Nach dem Review nichts selbst mergen oder deployen: Der Owner sieht UI-Änderungen live, bevor sie ausgerollt werden.

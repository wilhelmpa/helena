# Checkliste Design-Review Helena

Pro Seite abhaken; jeder Haken ohne Befund, jeder offene Punkt mit Ort und Screenshot.

## Kopfzeile und Toolbar
- [ ] Nur eine Kopfzeile; keine zweite Zeile mit Tabs, Filtern oder Buttons.
- [ ] Keine Beschreibungs-/Intro-Zeile unter der Kopfzeile.
- [ ] Ansichten, Suche, Filter, Aktionen liegen in der `PageToolbar` der Seite.
- [ ] Höchstens ein gefüllter Button, und der ist die Primäraktion.
- [ ] Bei 1100 px und 900 px faltet die Toolbar sauber (nichts abgeschnitten, nichts überlappt).

## Typografie
- [ ] Zeilen/Controls 13 px, Labels/Meta 12 px, Abschnittstitel 14 px, höchstens ein 16-px-Seitentitel.
- [ ] Keine anderen Größen, kein `font-bold` als Ersatz für eine Hierarchie, keine fremde Schrift.
- [ ] Gleiche Dinge sehen überall gleich aus (Tabellenzeile hier = Tabellenzeile dort).

## Flächen und Abstände
- [ ] Karten/Gruppen in `bg-card`, Hover/Auswahl in `bg-accent`.
- [ ] Controls 32 px, Icons 16 px, `rounded-md`; Schatten nur bei Popover, Menü, Dialog.
- [ ] Abstände auf dem 4-px-Raster (`p-4`, `gap-4`, Zeilenhöhe `h-8`).
- [ ] Keine rohen Farben; Status über `--status-*`-Tokens; dunkles Theme geprüft.

## Klickbarkeit und Verhalten
- [ ] Alles, was klickbar aussieht, reagiert; nichts Nicht-Klickbares hat Hover/Pointer.
- [ ] Zeilen, die zu einer Detailseite gehören, öffnen sie mit einem Klick auf die ganze Zeile.
- [ ] Leerzustand mit `EmptyState` (was fehlt, eine Aktion), kein nacktes „Keine Daten".
- [ ] Ladezustand ohne Springen des Layouts; Fehlerzustand verständlich (Deutsch).
- [ ] Dialoge: Titel 14 px, Esc schließt, Fokus im Dialog, Primäraktion rechts.
- [ ] Ungespeicherte Formulare: `UnsavedChangesBar` statt Speichern-Button in der Kopfzeile.

## Mobil (390×844)
- [ ] Kein horizontales Scrollen der Seite.
- [ ] Toolbar in der Zeile unter der Kopfzeile; nichts abgeschnitten.
- [ ] Touch-Ziele ≥ 40 px; Tabellen werden zu lesbaren Zeilen, nicht zu Mini-Spalten.

## Barrierefreiheit (WCAG 2.2 AA, Kurzprüfung)
- [ ] Textkontrast ≥ 4,5:1 (groß ≥ 3:1), auch im dunklen Theme.
- [ ] Sichtbarer Fokus bei Tastaturbedienung; Reihenfolge logisch.
- [ ] Icon-Buttons haben `aria-label`; Bilder `alt`; Felder ein `<label>`.
- [ ] Nichts nur über Farbe unterschieden (Status auch als Text/Icon).

## Texte
- [ ] Alle Texte aus i18n, in allen Sprachdateien vorhanden; keine englischen Reste in der deutschen Oberfläche.
- [ ] Produktname „Helena", nirgends „Plan"/„It's a Plan".
- [ ] Kurz, konkret, Du-Form wie im Rest der App; keine Floskeln.

## Konsole und Technik
- [ ] Browser-Konsole ohne Fehler und Warnungen beim Laden und bei jeder Aktion.
- [ ] Kein Element, das eine Seite baut, landet per Effekt im State eines Elternteils (Endlosschleife „Maximum update depth exceeded").
- [ ] Zwischenablage/IDs über `@/utils/clipboard` und `@/utils/uuid` (http im LAN).

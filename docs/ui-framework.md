# Helena UI-Framework

Stand 28.09.2026 (hub/ui-2). Verbindlich für jede Seite, jedes Feature und jedes Plugin. Grundlage: `docs/design-system.md` (Werte), `docs/ui-befunde-2026-09-28.md` (Owner-Befunde) und `docs/volition-helena-oss.md` §3a (Helena als Framework).

**Grundregel (Owner):** Alles wird aus Komponenten gebaut, niemand schreibt eigene Styles. Fehlt etwas, wird es als Komponente oder Variante ergänzt, nicht inline.

## 1. Öffentliche API

Es gibt einen einzigen Einstieg: `@/design-system` (`apps/web/src/design-system/index.ts`). Seiten, Features und Plugin-Slots importieren nur von dort.

| Bereich   | Bausteine                                                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tokens    | `tokens.css`: Farben hell/dunkel, Abstände `--space-1…7`, Radien `--radius-sm/md/lg/xl/full`, Seitenmaße. Tailwind liest dieselben Werte (`globals.css` `@theme`).                                                                                                                                           |
| Layout    | `Page` (Seitenschablone), `PageToolbar`, `PageTabs`/`Tabs`, `PageSearch`, `PageSelect`, `PageActions`, `SidePanel`, `Overlay`, `Modal`, `Dialog`                                                                                                                                                             |
| Anordnung | `Stack`, `Inline`, `Grid`, `Box` (Abstände nur aus der Skala), `Text` (Schriftgrößen und Töne)                                                                                                                                                                                                               |
| Bausteine | `Card`, `List`/`ListGroup`/`ListRow`, `Table`/`Th`/`Tr`/`Td`, `Pill`/`Badge`, `PillButton`, `Segmented`, `Button`/`ButtonLink`/`IconButton`, `TextField`/`TextArea`/`SearchField`/`Field`, `Switch`, `EmptyState`, `Menu…`, `ActionMenu`, `Tip`, `NameList`, `StatusDot`, `StatusPill`, `Orb`, `LocalChrome`, `Notice`, `TimeSeriesChart` |
| Muster    | `SettingsGroup`/`SettingsRow`, `FilterBar` (in `@/components/layout/FilterBar`, liest Projektdaten), `DetailView`/`DetailHeader`/`DetailGroup`/`PropertyGrid`, `Section`, `MonoLabel`                                                                                                                        |

Die **Galerie** zeigt jeden Baustein mit allen Varianten, hell und dunkel nebeneinander: Helena › Einstellungen › Entwicklung › UI-Bausteine (`/settings/ui`). Sie ist lebende Doku und Abnahmefläche für Screenshots.

## 2. Die Seitenschablone

Jede Route im App-Rahmen rendert genau eine `<Page>`. Der Test `src/app/pageTemplate.test.ts` schlägt fehl, wenn eine Seite das nicht tut.

```tsx
<Page
  actions={<PageActions primary={{ id: 'new', label: t('newTask'), icon: Plus, onClick }} />}
  toolbar={<><PageTabs … /><PageToolbarSpacer /><PageSearch … /></>}
  variant="default" // 'fill' | 'bleed' | 'reading'
>
  …Inhalt…
</Page>
```

- **Kopfzeile:** Breadcrumb und Titel kommen aus der Shell, auf jeder Seite gleich groß. Die Seite liefert nur die **Hauptaktion rechts** (`actions`).
- **Werkzeugzeile:** Tabs, Filter und Suche stehen immer in der Zeile unter dem Kopf (`toolbar` oder ein `<PageToolbar>` in der Seite), nie im Inhalt. Ist sie leer, entfällt sie.
- **Inhalt:** 24 px Abstand nach oben, 32 px seitlich (Handy 16 px), volle Breite. Keine eigenen Container-Breiten.
- **Varianten:** `default` scrollt; `fill` füllt die Höhe, das Kind scrollt selbst (Board, Organigramm); `bleed` ohne Innenabstand (Terminal, Code, Leinwand); `reading` zentriert Text auf 760 px (Dokument).
- **Verschachtelt:** Eine `Page` in einer `Page` (z. B. eine ältere Seite in Helenas Einstellungen) fügt nur Werkzeugzeile, Aktionen und Inhalt hinzu, kein zweites Padding.
- **Angeheftete Werkzeuge:** Ist das Panel angeheftet (Stecknadel im Panel-Kopf), macht die Seite Platz, statt verdeckt zu werden.

## 3. Menüs, Tabs, Leerzustände

- **Ein Tab-Muster:** `PageTabs` (bzw. `Tabs`) für jede Einfachauswahl in der Werkzeugzeile: Ansichten, Status-Tabs, Zeiträume. `Segmented` ist derselbe Look für Ansichtsumschalter (Baum/Kreis). Filter sind Chips der `FilterBar` bzw. `PageFilterMenu`.
- **Drei-Punkte-Menü:** Ein Menü mit nur einem Eintrag ist ein sekundärer Button. `PageActions` und `ActionMenu` machen das automatisch.
- **Leerzustand:** `EmptyState` mit Symbol, einem Satz und der Hauptaktion der Seite. Nie eine graue Zeile unter leeren Tabellenköpfen.
- **Icon-only-Knöpfe** bekommen immer ein Label und `Tip` (Tooltip).

## 4. Radien

Fünf Stufen, sonst nichts:

| Token / Klasse                   | Wert  | Wofür                                  |
| -------------------------------- | ----- | -------------------------------------- |
| `--radius-sm` / `rounded-sm`     | 6 px  | Chips, Badges, kleine Marken           |
| `--radius-md` / `rounded-md`     | 8 px  | Buttons, Eingabefelder, Bedienelemente |
| `--radius-lg` / `rounded-lg`     | 12 px | Karten, Zeilen, Menüs                  |
| `--radius-xl` / `rounded-xl`     | 16 px | Panels, Dialoge, Overlays              |
| `--radius-full` / `rounded-full` | voll  | Pillen, Avatare, Punkte                |

eslint lehnt alle anderen `rounded-*`-Klassen ab (`rounded`, `rounded-xs`, `rounded-2xl`, `rounded-[…]`). Der Test `src/design-system/radius.test.ts` prüft `border-radius` in CSS und `borderRadius` in Style-Objekten.

## 5. Abstände und Schrift

In `features/**` und `app/**` sind Tailwind-Klassen für Abstände (`p-4`, `gap-2`, `space-y-3`, `mt-1` …), Schriftgrößen (`text-sm` …) und Radien verboten. Stattdessen:

- `Stack gap={3}` (untereinander), `Inline gap={2} justify="between" wrap` (nebeneinander), `Grid min="card"` bzw. `Grid columns={2}` bzw. `Grid split`, `Box pad={4}`. `Grid min="fit"` teilt eine Zeile unter beliebig vielen Karten auf (Kennzahlen des Dashboards), auf dem Handy zweispaltig. `Grid min="figure"` ist dasselbe für lange Zahlen wie Geldbeträge und steht auf dem Handy einspaltig.
- `Text size="xs|sm|md|lg" tone="muted|faint|accent|danger|success|warning" mono truncate`.
- Die Skala: 1 = 4 px, 2 = 8, 3 = 12, 4 = 16, 5 = 24, 6 = 32, 7 = 48.

Layout-Klassen ohne Werte (`flex`, `grid`, `items-center`, `min-w-0`, `flex-1`, `truncate`) bleiben erlaubt. Farben kommen nur aus Tokens (bestehende Regel: keine Palette-Klassen, keine Hex-Werte, keine `[…]`-Werte).

**Bestand:** Was vor der Regel da war, steht in `apps/web/eslint-suppressions.json` (ESLint Bulk Suppressions). Neue Verstöße schlagen fehl; jede umgebaute Datei verkleinert die Liste (`bunx eslint --prune-suppressions .`). Die Liste wird nur kürzer.

## 6. Eine neue Variante ergänzen

1. Gibt es den Baustein schon? In der Galerie nachsehen.
2. Fehlt nur eine Ausprägung, bekommt der Baustein eine Prop (z. B. `tone`, `size`, `variant`) und die Regel in `components.css` bzw. `shell.css`, nur mit Tokens.
3. Fehlt ein Baustein, entsteht er in `design-system/components/` (oder `layout/`) und wird in `index.ts` exportiert.
4. Die Galerie (`features/ui-gallery/UiGallery.tsx`) zeigt die neue Variante hell und dunkel.
5. Texte stehen in allen 10 Sprachen (`messages/*`).

## 7. Plugins und Erweiterungspunkte

Plugin-Slots (Dashboard-Widgets, Panel-Werkzeuge, Einstellungsseiten eines Projekts) rendern mit denselben Bausteinen. Ein Plugin bringt Daten und Aktionen, keine eigene Optik; Beispiel: das Trading-Dashboard (`TradingDashboard.tsx`) nutzt `Page`, `PageTabs`, `PageActions`, `Stack`, `Grid split`.

## 8. Plätze für neue Funktionen (Owner, 28.09.: nur integriert, eine Quelle der Wahrheit)

Funktionen nach dem Vorbild von Hermes, OpenClaw und Paperclip bekommen keine eigene Oberfläche. Sie gehen in bestehende Seiten, gebaut mit diesem Framework, und zuerst gilt: Braucht sie überhaupt eine sichtbare Einstellung?

| Funktion                                        | Ort                                                                                                                                                                                                                                                                                                                                | Baustein                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Budgets, Drossel, harter Stopp                  | Projekt › Einstellungen › Agenten › **Autopilot & Ausführung** (Überschreibung, markiert, „Auf Vorgabe zurücksetzen“); Vorgabe unter **Vorgaben für Projekte** (`DefaultBudgetsGroup`, gilt für neue Projekte); Anzeige: Dashboard-Kachel „Budgets“, Projektkarten, „Braucht dich“ (aufgebraucht = gestoppt, ab 80 % = gedrosselt) | `SettingsGroup` „Budgets“, `BudgetsTile`, `budgetNeedsYouSource` |
| Dauerhafte Anweisungen                          | Projekt › **Autopilot & Ausführung** (Gruppe „Anweisungen“ mit den Projektanweisungen); für Helena unter **Vorgaben für Projekte**; Vorschläge der Agenten übernehmen/ablehnen                                                                                                                                                     | `StandingOrdersGroup`                                            |
| Eskalation                                      | **Agenten und Modelle** (zentrale Regeln, als „Vorbereitet“ markiert, bis die zentrale Laufzeit sie befolgt); Agent-Dialog › Modell & Verhalten nur „Festlegung für diesen Agenten“                                                                                                                                                | `LocalAiEscalationSection`, `AgentEscalationPin`                 |
| Telegram-Kanal                                  | **Benachrichtigungen & Kanäle** › Telegram                                                                                                                                                                                                                                                                                         | vorhanden                                                        |
| Heartbeat, Gedächtnis, Fakten, Skills pro Agent | Agent-Detail (Agent-Dialog); der Herzschlag zeigt Vorprüfung, Drossel und die letzten Prüfungen gebündelt, der Verlauf bündelt Herzschlag-Läufe                                                                                                                                                                                    | `DetailView`, `SettingsGroup`, `List`                            |
| Skills, Selbstlernen                            | **Skills** (Katalog)                                                                                                                                                                                                                                                                                                               | vorhanden                                                        |
| Ziel-Leiter                                     | Helena › Ziele (rechte Spalte, „Warum“), Projekt-Ziele (Zeile und „Warum“ im Ziel), Aufgabendetail („Warum“)                                                                                                                                                                                                                       | `DetailGroup`, `.ds-ladder`, `.ds-why`                           |
| Aufgaben-Übernahme                              | Aufgabendetail „Bearbeitet von …“ (Lease des Laufs, `GET /issues/:id/claim`)                                                                                                                                                                                                                                                       | Eigenschaftszeile                                                |
| Sitzungssuche                                   | globale Suche (⌘K) über Chats und Agentenläufe (Wissensindex des Workers)                                                                                                                                                                                                                                                          | Befehlspalette                                                   |

## 9. Abnahme

Pro Paket eine Klick-Abnahme im echten Browser über alle betroffenen Seiten: hell und dunkel, Desktop 1440 und Handy 375, Konsole ohne Fehler. Was nicht funktioniert, wird repariert oder verschwindet aus der UI.

Der Einstieg `@/design-system` ist reine Darstellung: Er zieht keinen API-Client, keine Dienste und keine Datenhooks nach sich (Test `design-system/barrel.test.ts`). Komponenten, die Daten lesen (Composer, Agentenwahl, FilterBar mit Projektdaten), liegen außerhalb und bauen selbst auf dem Framework auf.

## 10. Muster aus Paket 3+4 (hub/ui-3a)

- **Agenten-Chip** (`.ds-agent-chip`): wer antwortet, mit welchem Modell, wie Menschen es nennen („Helena · Flash (lokal)“,
  `utils/modelNames.ts`), bei einem Rückfall zusätzlich „Rückfall: …“. Die Variante `data-variant="quiet"` ist der Ein-Klick-Weg
  zu Helena, wo ein Projekt-Agent vorn steht.
- **Orb**: zeigt nur den Zustand dieses Chats (bzw. ob der Agent antworten kann). Arbeit des Agenten anderswo ist ein dezenter
  Hinweis über dem Composer (`.ds-chat-busy-note`), nie Bewegung des Orbs. Im hellen Design zeichnet `voice-orb theme="light"`
  Farbe statt Licht; kein dunkler Untergrund.
- **Drawer in einer Box** (`.ds-drawer-host`/`.ds-drawer`): schwebendes Panel über seiner Box (Chatliste im schmalen Chat), an
  der Seite des Knopfs, der es öffnet — nie eine zweite Spalte neben der Sidebar.
- **Terminal-Leiste** (`.ds-terminal-bar`): die Tabs im Look der Panel-Tabs, darunter die Freigabe als ruhige Zeile
  (`.ds-terminal-grant`).
- **Aufgabenliste**: jede Gruppe eingefasst (`.ds-issue-list-box`), Zeilen in festen Spalten (Schlüssel · Titel · Status-Box
  `.ds-issue-status` · Priorität · Fälligkeit · Personen), damit nichts springt.
- **Zweispaltige Liste/Detail** (`.ds-goals-split`): Karten links, das Gewählte rechts; unter 900 px abwechselnd mit Rückweg.

## 11. Wissen, Dateien, Belege (hub/ui-3c, Befund G)

- **Ein Menüpunkt, drei Sichten** auf dieselben Dateien: „Wissen“ (Docs, Leinwände, Ansichten `.base`), darunter „Dateien“ (alle übrigen Dateien) und „Belege“ mit Offen · Prüfen · Zugeordnet · Export, dann die Ordner. Kein zweiter Tab-Streifen auf der Seite. Der feste Ordner `Files` heißt „Ablage“, damit er nicht mit der Sicht „Dateien“ verwechselt wird. Auf Helena-Ebene: Wissen (alles, jede Datei mit Ort und Projekt), Dateien, Helena, Privat, Vorlagen.
- **Ein Pfad:** Der Breadcrumb der Shell ist der ganze Pfad (Projekt · Wissen · Ordner … / Datei); die Seite wiederholt ihn nicht. Aktionen der Datei stehen rechts im Kopf (`Page actions`).
- **Öffnen:** Ein Klick öffnet jede Datei rechts im einen Overlay (`KnowledgePreview`). Darunter stehen die Aktionen der Datei **mit Namen** (`FileActionBar`: Herunterladen, Link kopieren, An Chat anhängen, Umbenennen, Verschieben, In den Papierkorb; Seltenes unter „Weitere Aktionen“) – nie ein namenloses „…“. Dieselbe Liste zeichnet das Zeilenmenü (`useFileActionItems`), eine neue Aktion wird einmal ergänzt. „Als Seite öffnen“ (Pfeil im Kopf) oder Doppelklick öffnet groß in der Seite; **Vollbild** macht das Overlay groß und wieder klein (siehe §12).
- **Ein Feld, kein Rahmen im Rahmen:** Die Datei sitzt auf einer Fläche (`--surface-2`, ohne eigenen Rand); der Innenabstand des Datei-Overlays ist `--space-3`. Alles, was Text ist (md, txt), öffnet im Markdown-Editor **formatiert** (`DocumentEditorField`: Werkzeugleiste oben, sichtbare Fläche, Cursor in Textfarbe), der Quelltext ist der Umschalter „Formatiert | Quelltext“ darüber. Was der Editor nicht exakt behalten kann, öffnet direkt als Quelltext (editierbar).
- **Viewer** (`components/common/files/FileViewerContent`, immer auf einer Fläche): Text/Code mit Hervorhebung, Tabellen (CSV/TSV, später Excel-Blätter) als `SheetView` (Blatt-Umschalter, erste Zeile als Kopf, Kopf bleibt stehen, nur die ersten 500 Zeilen × 60 Spalten), PDF (Browser-Viewer), Bild mit Zoom, Audio/Video, Office-Dateien (`FileViewerOffice`, Auftrag 127: der eigene Umwandler des Servers macht Dokumente und Folien zu Seiten (PDF), eine Tabelle zu Blättern mit „Tabelle | Seiten“; geht es nicht – zu groß, beschädigt, Zeitlimit, Dienst aus –, steht der Grund im Klartext, dazu der extrahierte Text bzw. der Download; die Adressen laufen über `/protected-media/knowledge/preview/file`) und für alles andere `FileViewerFallback` (Symbol, Name, Art, Größe, Herunterladen).
- **Ordnerarten** (`utils/knowledgeFolders.ts`, `describeFolder`): **System** (Dokumente, Ablage, Anhänge, Leinwände, Eingang und die von Helena angelegten Agenten, Belege, Mail, Chats, Browser, Aufgaben – jeweils mit eigenem Symbol), **Aufgabe** (`Files/Tasks/<KEY-n>`, Symbol Häkchen in der Akzentfarbe) und **eigene** (Symbol Ordner, Name genau wie getippt). Was Helena aus einem Slug anlegt (Chat-Ordner „planung-relaunch“), zeigt einen lesbaren Namen mit großem Anfangsbuchstaben. Pfade auf der Platte ändern sich nie, nur die Anzeige. Baum (`TreeItem mark`), Ordnerseite, Liste („Ort“, `FolderMark`) und Overlay fragen dieselbe Stelle.
- **Herkunft:** `OriginBadge` (System, Agent) neben dem Namen; manuelle Dateien tragen keine Marke. Filter „Alle · Manuell · Agent · System“ in der Werkzeugzeile, auf dem Handy als ein `PageSelect`. Helenas eigene Ordner haben ein eigenes Symbol (`folderIcon`), Ordner von Menschen das normale.
- **Leerzustände:** `EmptyState` mit Titel, einem Satz und der Hauptaktion (Doc anlegen, Datei hochladen, Beleg hochladen); ein Ordner nur mit Unterordnern bietet sie als Knöpfe an. Nie Spaltenköpfe über einer leeren Liste.
- **Ansichten (`.base`):** `KnowledgeBaseView` zeigt Tabelle, Karten oder Liste (`Segmented`), filtert die Zeilen und öffnet die Notiz einer Zeile; nicht auswertbare Ausdrücke sagt sie offen. „Neu › Ansicht“ legt eine Ansicht über den Ordner an.
- **Einstellungen › Wissen & Belege:** Belege zusammenführen, Beleg-Eingang, „Belege als Notizen“ (+ neu aufbauen), Bankkonten, Agenten als Notizen (Vorschau, in Wissen ablegen).

## 12. Neues Modul: so sieht die Leiste aus (Auftrag 117)

Jedes Modul – auch jedes neue – baut seine obere Leiste gleich, Aufgaben ist die Referenz. Der Test `src/app/toolbarGuard.test.ts` liest alle Seiten, Features und `components/helena` und schlägt fehl, wenn ein Modul eigene Teile baut.

```tsx
<Page
  actions={<PageActions primary={{ id: 'new', label: t('new'), icon: Plus, onClick }} actions={[…]} />}
  toolbar={
    <>
      <Segmented …/>            {/* Ansicht: Board · Liste · Tabelle, Kreis · Baum · Liste */}
      <PageTabs …/>             {/* Einfachauswahl mit Zählern: Alle · Agenten · Vorlagen */}
      <FilterBar …/>            {/* bzw. PageFilterMenu: Filter als Chips */}
      <SegmentToggle …/>        {/* ein Schalter im Segment-Look (Aufgaben-Ring im Team) */}
      <PageToolbarSpacer />
      <PageSearch …/>           {/* die eine Suche, auch in Wissen und Belege (⌘K) */}
    </>
  }
>
```

- **Reihenfolge:** Ansicht (`Segmented`), dann Auswahl/Filter (`PageTabs`, `FilterBar`/`PageFilterMenu`, `SegmentToggle`), Abstandhalter, Suche. Die Hauptaktion steht rechts im Kopf (`PageActions`), Seltenes in ihrem „…“.
- **Verboten** (der Test nennt Datei und Zeile): ein eigenes Suchfeld (`<input type="search">`), eigene Filter-Pillen (`ds-pill-button`), eine lose `PillButton`, ein rohes `<input>` oder ein `SearchField` in einer `PageToolbar`.
- **Fehlt etwas,** kommt es zuerst als Baustein ins Design-System (§6), dann ins Modul.
- **Overlay:** Was aufgeht (Aufgabe, Lauf, Agent, Datei, Beleg), nutzt `Overlay` mit `pin` – Kopf: eigene Aktionen, dann (falls die Sache eine eigene Seite hat) „Als Seite öffnen“ (`onOpenPage`), Anheften, Vollbild, Schließen. Angeheftet bleibt es beim Seitenwechsel offen (`utils/overlayPin`).
- **Ein Satz Kopfknöpfe (`OverlayControls`, O83):** Eigene Seite · Anheften · Vollbild ↔ normal · Schließen, immer diese Reihenfolge, dieselben Symbole (Pfeil, Nadel, Vergrößern/Verkleinern, X), Größen, Tooltips und Beschriftungen – im Overlay, im Werkzeug-Panel (`WorkspaceTabBar`), im Bereichskopf, im Dialog (`Modal`) und im Aufgaben-Kopf der Inbox. Vollbild ist ein echter Umschalter: dasselbe Symbol macht groß und klein (aria-pressed), Esc verlässt zuerst das Vollbild, ein angeheftetes Overlay behält Zustand und Größe über Seitenwechsel (`usePinnedOverlayFull`). Was „Anheften“ bedeutet, darf abweichen (Overlay: bleibt offen; Panel: dockt neben die Seite), Aussehen und Bedienung nicht: `labels` ersetzen nur den Text. Der Guard `app/overlayControlsGuard.test.ts` meldet eigene Vergrößern-/Verkleinern-Knöpfe, handgezeichnete Kopfknöpfe und einen Kopf ohne `OverlayControls`.
- **Inbox:** Alle Inbox-Seiten laufen bis zum Rand (`Page variant="bleed"`), nur die Leiste behält den Seitenrand. Projekt-Inbox: nur dieses Projekt (Tabs Nachrichten · Updates). Home-Inbox (`/inbox`): dieselben Tabs; „Nachrichten“ ist die Post aller Konten und Projekte (mit Projekt- und Kontofilter, Projektmarke je Zeile), „Updates“ (`?tab=updates`) sind Freigaben, Erwähnungen und Läufe zum Lesen mit Zähler am Tab. Die Mail-Vorschau übernimmt die Fläche des Designs: im dunklen Design wird eine HTML-Mail invertiert auf die Oberfläche des Programms gelegt (`mailFrameDocument`), Fotos bleiben unverändert.
- **Global und im Projekt:** Eine Einstellung, die es auf beiden Ebenen gibt, zeigt im Projekt `InheritedMark` („Erbt von Ava“ bzw. „Für dieses Projekt geändert · Zurücksetzen“).
- **Prüfen:** `node apps/web/scripts/ui-audit.mjs` misst gegen ein laufendes Ava Hintergründe (nur Tokens, kein Weiß im Dunkeln), Seitenabstände der Seitenschablone und die Rahmen/Status-Boxen der Aufgaben – hell und dunkel, 1440 und 390 px.

## 12. Ebenen und Aufgaben-Ansichten (hub/work-items-schoen)

- **Ebenen (z-index), von unten nach oben:** Seite → Werkzeug-Panel 50 → das eine Overlay (Aufgabe, Lauf, Agent) 55 → Sidebar als Schublade 70 → Menüs, Popover, Auswahlen, Tooltips (**75**) und Dialoge (**80/81**), die aus dem Overlay aufgehen → große Modal 100 → deren Menüs 120/121 (`design-system/overlays.css`). Ein Popover unter dem Overlay ist unsichtbar: Genau das hat im Aufgaben-Overlay zehn von zwölf Eigenschaften unbedienbar gemacht (29.09.). Neue Ebenen gehören in diese Reihenfolge, nie ein eigener Wert im Baustein.
- **Nichts Schwebendes über Klickbarem:** Etwas, das über dem Inhalt schwebt (Kommentar-Karte, Hinweis), darf Bedienelemente nicht verdecken. Die Karte „letzter Kommentar“ steht deshalb nur auf der Aufgabenseite, wo die Eigenschaften eine eigene Spalte sind, nicht im Panel und in der Inbox.
- **Ziel einer Aufgabe** ist ein Organisationsziel (`helena_goal_task`), keine Initiative: `issue.goal`, `goalId` beim Anlegen, Ändern, Sammeländern und im Filter, Auswahl `GoalSelect` (Projekt · Abteilung · Übergreifend, mit Fortschritt; Team-Owner und -Manager legen ein Ziel direkt in der Suche an). Der alte Initiativ-Filter erscheint nur noch, wo eine gespeicherte Ansicht ihn benutzt.
- **Felder** (`FieldsControl`): Knopf „Felder“ in der Werkzeugzeile von Board, Liste, Tabelle und Kalender. Chips, Vorschau (die Karte des Boards bzw. die Spaltennamen), „Als Standard für dieses Projekt speichern“ (Projekt-Admin) und „Für alle meine Projekte speichern“ (jedes Mitglied). Eine Ansicht, die nie geändert wurde, folgt dem Standard (Projekt vor Mitglied vor Vorgabe); eine gespeicherte Ansicht behält ihre eigenen Felder. Speicher: `project.display_defaults`, `user_preference.field_defaults`, API `/projects/:key/display-defaults`.
- **Leise Balken** im Zeitstrahl (`quietBar`): Statusfarbe als Tönung mit Streifen am Anfang, Text in Normalfarbe, kein Vollton mit weißer Schrift.

## 13. Trading-Dashboard (O86) und die Bausteine dazu

Das Trading-Dashboard zeigt nur an (Konto, offene Positionen mit Schutz-Stop, Orders, Ergebnis-Verlauf, Strategien und Freigaben, Entscheidungen); es hat keinen Knopf, der eine Order auslöst, schließt oder die Sperre ändert (Test `TradingWidgets.test.tsx`). Aufbau: `features/dashboards/components/TradingDashboard.tsx` (Seite), `TradingDataWidget.tsx` (ein Widget mit Lade-, Fehler- und Leerzustand) und `components/trading/*` (je Widget ein Inhalt).

- **`Notice`**: ein Zustand, den man nicht übersehen darf, in einer Seite oder Karte (Ton `neutral`, `warning`, `danger`, Symbol, Titel, höchstens zwei Sätze, optional eine Aktion). Kein Toast, keine Fehlerseite. Beispiele: „Handel angehalten“ (danger), „Limits fehlen“ (warning), Widget ohne Daten.
- **`TimeSeriesChart`**: eine Linie über der Zeit mit sanfter Fläche (Werte rechts, Zeit unten, Tooltip). Der Aufrufer formuliert Achsen und Tooltip (`formatX`, `formatY`), der Baustein kennt keine Sprache. Ton `accent`, `success`, `danger`.
- **`Tile compact`** für Geldbeträge (kleinere Zahl, Notiz darf umbrechen); **`BudgetBar`** zeigt auch den Verbrauch eines Limits (nur `ratio`, `warned`, `reached`).
- **Widget in zwei Rahmen:** Auf der Trading-Seite sitzt jedes Widget in einer eigenen Karte (`framed`), im Dashboard-Raster (Layout bearbeiten) zeichnet nur der Körper, weil der Raster-Rahmen Titel und Rand hält.
- **Paper-Konto:** Gibt es mehrere Verbindungen oder ist die gewählte weg, zeigt die Seite EINE Auswahl statt vier gleicher Meldungen (Strategien und Entscheidungen brauchen das Konto nicht und bleiben). Die Wahl steht im Layout aller Konto-Widgets (`config.credentialId`); ohne Recht zum Bearbeiten gilt sie bis zum Verlassen der Seite. Im Raster gibt es sie als Widget-Einstellung.
- **Fehlertexte:** Die API nennt Gründe englisch (`widget-data.ts`); `utils/tradingErrors.ts` macht daraus Arten, die in allen Sprachen formuliert sind. Unbekanntes wird „konnte nicht geladen werden“, nie ein roher Serversatz.

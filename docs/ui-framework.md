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
| Bausteine | `Card`, `List`/`ListGroup`/`ListRow`, `Table`/`Th`/`Tr`/`Td`, `Pill`/`Badge`, `PillButton`, `Segmented`, `Button`/`ButtonLink`/`IconButton`, `TextField`/`TextArea`/`SearchField`/`Field`, `Switch`, `EmptyState`, `Menu…`, `ActionMenu`, `Tip`, `NameList`, `StatusDot`, `StatusPill`, `Orb`, `LocalChrome`, `Notice`, `TimeSeriesChart`, `TextDiff`, `CodeBlock`, `CopyValue` |
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

- **Kopfleiste (Owner 30.09., O104):** EINE Leiste, 56 px, auf jeder Seite gleich (`PageHeader`). Links eine kompakte Breadcrumb, deren letztes Glied der Seitentitel ist (18 px); die früheren Glieder (Projekt, Bereich, Elternseite) stehen zurückhaltend (13 px) und klickbar davor, es gibt keinen zweiten Titel daneben. Direkt danach, in derselben Leiste, alle Steuerungen der Seite (`toolbar`, siehe unten), ganz rechts die Hauptaktion (`actions`). Bei Platzmangel gibt die Breadcrumb ihre Mitte her („Projekt › … › Seite“), dann bleibt nur der Seitenname; danach faltet die Werkzeugleiste (Suche → Symbol, Aktionen → „…“, Tabs → Auswahl). Unter 900 px rücken die Steuerungen in eine 44-px-Zeile derselben Leiste unter die Breadcrumb. Die Verwaltung und das Konto (`StandaloneShell`) nutzen dieselbe Leiste; die Wahl „klassische Kopfzeile“ gibt es nicht mehr.
- **Werkzeuge der Seite:** Tabs, Filter, Suche und Ansicht (`toolbar` oder ein `<PageToolbar>` in der Seite) stehen in dieser Leiste (der `bar`-Platz von `PageHeader`, in den `PageToolbar` per Portal rendert), nie im Inhalt. Ist sie leer, entfällt sie.
- **Inhalt:** 24 px Abstand nach oben, 32 px seitlich (Handy 16 px), volle Breite. Keine eigenen Container-Breiten.
- **Varianten:** `default` scrollt; `fill` füllt die Höhe, das Kind scrollt selbst (Board, Organigramm); `bleed` ohne Innenabstand (Terminal, Code, Leinwand); `reading` zentriert Text auf 760 px (Dokument).
- **Verschachtelt:** Eine `Page` in einer `Page` (z. B. eine ältere Seite in Helenas Einstellungen) fügt nur Werkzeugzeile, Aktionen und Inhalt hinzu, kein zweites Padding.
- **Angeheftete Werkzeuge und Overlays:** Ist ein Panel oder Overlay angeheftet (Stecknadel im Kopf), wird der ganze Hauptbereich – Kopfleiste und Seite – genau um dessen Breite schmaler, nichts liegt darunter (`utils/dock.ts`, `--ds-dock-inset` an `.ds-main`); die Seitenleiste tritt auf die schmale Leiste zurück, wo die Seite sonst zu eng würde. Unter 1024 px gibt es kein Anheften: ein Overlay ist dort ein Vollbild-Sheet.

## 3. Menüs, Tabs, Leerzustände

- **Ein Tab-Muster:** `PageTabs` (bzw. `Tabs`) für jede Einfachauswahl in der Werkzeugzeile: Ansichten, Status-Tabs, Zeiträume. `Segmented` ist derselbe Look für Ansichtsumschalter (Baum/Kreis). Filter sind Chips der `FilterBar` bzw. `PageFilterMenu`.
- **Drei-Punkte-Menü:** Ein Menü mit nur einem Eintrag ist ein sekundärer Button. `PageActions` und `ActionMenu` machen das automatisch.
- **Leerzustand:** `EmptyState` mit Symbol, einem Satz und der Hauptaktion der Seite. Nie eine graue Zeile unter leeren Tabellenköpfen.
- **Icon-only-Knöpfe** bekommen immer ein Label und `Tip` (Tooltip).
- **Baum und Seitenleiste (`Tree`, `TreeItem`):** Eine Gruppe mit genau einem einfachen Link (ohne eigene Seite, ohne Aktionen) ist dieser Link: kein Pfeil, keine Liste, die Zeile führt direkt hin und ist markiert, wenn der Link es ist (Owner, O89). Eine Gruppe, die nichts rendert, hat ebenfalls keinen Pfeil. Ein Bereich mit einem einzigen Dashboard verlinkt direkt darauf; erst ab zwei klappt die Liste auf. `TreeNote` ist die stille Textzeile im Baum, `TreeSearch` das Suchfeld eines Baumabschnitts (beide auf der Einrückung der Zeilen darum); ein Suchfeld, das erst auf Wunsch aufgeht, nimmt mit `focusOnOpen` den Cursor und schließt mit `onEscape`. `TreeMoreButton` ist das „…“ einer Zeile oder eines Bereichs (Auslöser des Optionsmenüs), `TreeAction` mit `hoverOnly` bleibt auf Touch-Bildschirmen weg (dort tut der Bereich dasselbe). Die Seite `/` ist der Home-Chat und markiert „Chats“; das Dashboard hat eine eigene Seite `/dashboard` mit den Ansichten „Übersicht“ und „Alle Projekte“ (`?view=projects`, `features/home/dashboard/views.ts`). Der Chat-Bereich der Seitenleiste (Owner, O100): Gruppen sind eingeklappt bis auf Angeheftetes (sonst den ersten Agenten) und die Gruppe des offenen Chats, jede mit ihrer Chat-Zahl, ab fünf Chats faltet „Weitere n“ den Rest; Archiv und Papierkorb sind Ansichten, zwischen denen das „…“ des Bereichs umschaltet, kein Zeilenpaar; das Projektkürzel steht nur, wo die Liste Projekte mischt. Das Logo und der Orb öffnen den Chat mit dem Hauptagenten des Ortes (`mainAgentOf`, `mainChatLocation`, `useMainChat`): im Projekt dessen Koordinator, in Home Ava; nie den Chat eines anderen Agenten, gewechselt wird im Composer.
- **Chats in der Seitenleiste (Owner, O87):** `features/ai-chat/components/sidebar/SidebarChats` ist ein Bereich der Ebene 1 unter „Du“: Angeheftet, eigene Ordner, dann ein Abschnitt je Agent (Home-Agent, Koordinatoren, Spezialisten; `utils/chatSections`), dazu Suche, Archiv und Papierkorb. Das Chat-Fenster (Seite und Panel) zeigt nur die Unterhaltung, es hat keine eigene Chatliste. Ein Klick öffnet den Chat auf der Chat-Seite seines Ortes; ist das Chat-Werkzeug im Panel offen und man auf einer anderen Seite, öffnet er ihn im Panel und lässt die Seite stehen.
- **Chat-Eingabefeld (Owner, O84):** Eine Zeile Text (auch der Platzhalter) steht genau in der Mitte des Feldes: `PromptInputTextarea` leitet das Polster aus `--ds-chat-field-min` und `--ds-chat-field-line` ab; wer das Feld höher macht (Startseite), setzt nur diese Variable.

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
- **Prüfen:** `node apps/web/scripts/ui-audit.mjs` misst gegen ein laufendes Ava Hintergründe (nur Tokens, kein Weiß im Dunkeln), Seitenabstände der Seitenschablone, die Rahmen/Status-Boxen der Aufgaben, die linken Kanten und Abstände von Kopf, Werkzeugzeile und erstem Inhalt jeder Seite und öffnet Chat-Panel, Aufgabe, Agent, Datei und Einstellungen, um Kopf, Knöpfe, Abstände, Esc und das Anheften zu vergleichen – hell und dunkel, 1440 und 390 px (§17).

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

## 14. Agent-Seiten: Skills, Gedächtnis, Anweisungen, Lernen (hub/ui-agent-pages, 30.09.)

Der Agent-Dialog (`features/settings/AgentDialog`) hat die Tabs **Übersicht · Einstellungen · Skills · Gedächtnis · Läufe · Sitzungen · Verbrauch · Laufzeit**. Alles darin sitzt im selben Rahmen `AgentPage`/`AgentPages` (`features/teams/components/ai-agents/AgentPage`): Titel mit einem Satz, Zähler oder Aktion rechts, optional `back` (Rückweg aus einem Detail in seine Liste); gleiche linke Kante und gleicher Abstand wie die Seiten der Einstellungen. Neue Tabs kommen über die Registry `agentTabs.tsx`.

- **Skills** (`AgentSkillsPanel`): eine Liste statt 120 Schaltern. Ansicht als `Segmented` (Zugeordnet · Bibliothek · Vorschläge · Archiv, die beiden letzten nur mit Inhalt), Suche daneben, Gruppen je Herkunft (`ListGroup`: Gelernt, Aus der Bibliothek, Installiert, Mitgeliefert; Mitgeliefertes ab 8 Einträgen eingeklappt). Der Datenaufbau steht in `utils/skillEntries.ts` (rein, getestet): Bibliotheks-Skills einmal (nicht nochmal als Kopie in der Laufzeit), lesbare Namen (`readableName`), erster Satz der Beschreibung (`shortDescription`). Ein Klick öffnet den Skill als eigene Seite (`SkillDetail`): Inhalt und – für gelernte Skills der eigenen Laufzeit – **Verlauf** (`SkillHistory`: je Version was passiert ist, wer, wann, Sitzung, Vorher/Nachher-Diff), mit Freigeben/Ablehnen eines Vorschlags (`POST …/learned-skills/review`), Anheften, Archivieren, Wiederherstellen und „In die Bibliothek übernehmen“. Bibliotheks-Skills und Mitgeliefertes schaltet der Schalter in der Zeile (er sitzt im `meta` der `ListRow`, weil `actions` erst beim Überfahren erscheint).
- **Gedächtnis** (`AgentMemoryPanel`): Gedächtnis (MEMORY und USER als lesbare Einträge: Hermes-Dateien mit „§“ werden zur Liste, die Trenner erscheinen nie; Bearbeiten als Eintragsliste oder im Markdown-Editor) · Tagesnotizen (nach Datum, Uhrzeit vorn) · Fakten (Suche, Vertrauen, „Stimmt“, Bearbeiten, Entfernen) · Vorschläge (Freigabe) · Versionen (Diff). Der Zustand kommt aus dem Bericht der Laufzeit, sonst aus der neuesten Fassung (`utils/memoryFiles.ts`).
- **Anweisungen** (Einstellungen › Anweisungen, `AgentInstructionsBody`): Persönlichkeit (SOUL), Anweisungen des Agenten, weitere Anweisungsdateien (`instructions/*.md`, Liste mit Hinzufügen/Entfernen) und „Erbt von …“ (Vorlage mit Zurücksetzen, Projektanweisungen). Alles in `MarkdownField`.
- **Lernen & Träumen** (Einstellungen › Lernen & Träumen, `AgentLearningSettings`): Schalter in Alltagssprache (Aus Erfahrungen Skills lernen, Skills aufräumen, Änderungen vorher zeigen, Rückblick nach Läufen/Chats), „Nachts konsolidieren“ (Träumen, nur eigene Laufzeit) und die Größengrenzen. Kein „Hermes“, „Runner“ oder „Kurator“ auf dem Bildschirm; `i18n/agentPages.test.ts` prüft das für Deutsch und Englisch.
- **`MarkdownField`** (`components/helena`): der Markdown-Editor des Wissens (`DocumentEditorField` mit Werkzeugleiste, `DocumentMarkdownEditor`) für jeden Markdown-Text, der keine Vault-Datei ist. Schalter „Formatiert | Quelltext“; ein Text, den der Editor nicht unverändert zurückschreiben kann, öffnet als Quelltext. Ohne `onUploadImage` fehlt der Bildknopf.
- **`LimitMeter`** (`@/design-system`): Größengrenzen wie in Hermes (MEMORY 2 200, USER 1 375 Zeichen, SOUL/Anweisungen 20 000): „1.840 / 2.200 Zeichen“, dünner Balken, Warnfarbe ab 90 %, ab dem Limit rot mit „Zu lang – bitte kürzen oder konsolidieren lassen“ (Speichern gesperrt), Zeile „Wird für das Modell gekürzt“ bei `truncated`. Die Daten kommen als `agent.sizeLimits[area] = { used, limit, truncated? }` (Bereiche `memory`, `user`, `dailyNote`, `soul`, `agentInstructions`, `projectInstructions`; `features/agent-runtime/utils/sizeLimits.ts`). Fehlt das Feld (älterer Server), erscheint nichts, außer beim Gedächtnis-Editor mit der harten Grenze der API (16 384 Zeichen).
- **Kleine Bausteine dieser Runde:** `ListRow` hat den Platz `control` für ein Bedienelement, das sichtbar neben der Zeile bleibt (ein Schalter, außerhalb des Zeilen-Buttons, also nie ein Button im Button; `actions` erscheinen erst beim Überfahren). Die Tabs eines `Overlay` schrumpfen nie zu Stummeln: auf schmalem Bildschirm läuft die Tab-Zeile seitlich und der offene Tab wird ins Bild gescrollt. Die Ansichten einer Agent-Seite (`Segmented`) laufen dort ebenfalls seitlich, statt aus der Seite zu ragen. `agentFormPages` führt für eine Vorlage (sie hat keine Tabs) zusätzlich die Seite „Skills“, dieselbe Liste eingebettet.
- **Läufe und Sitzungen** (Tabs des Agent-Dialogs) sitzen im selben Rahmen wie Skills und Gedächtnis: `AgentPage`, `List`/`ListRow` (`RunRow` ist eine `ListRow`, auch in der Übersicht; Hinweise wie archiviert, blockiert, Modell abgelehnt/gewechselt, Autopilot-Stufe, Tokens stehen als eine ruhige Zeile darunter), `EmptyState`, `SearchField`. Der Lauf im Detail (`RunView`) und das Transkript einer Sitzung haben dieselbe linke Kante (`.ds-agent-overlay .ds-run`).
- **Bubble-Menüs des Editors (O97):** `BubbleMenu` von tiptap registriert sein Plugin (eine weitere Transaktion) neu, sobald `options` oder `shouldShow` die Identität wechseln. Wer sie bei jedem Render neu baut, erzeugt aus jeder Transaktion einen Render und aus jedem Render eine Transaktion; React bricht das bei vielen Tastenanschlägen in einem Zug mit „Maximum update depth exceeded“ ab. `EditorSelectionMenu` und `EditorTableMenu` geben stabile Werte weiter; `EditorMenus.test.tsx` prüft, dass ein Render nie eine Transaktion auslöst. Neue Menüs mit `BubbleMenu`/`FloatingMenu` müssen dasselbe tun.

## 15. Matrix aus Einstellungen (O85, Agenten und Modelle)

Eine Matrix ist eine `Table` mit bearbeitbaren Zellen (`Matrix.tsx`): Zeilen sind Dinge (Agenten, Aufgabenklassen), Spalten sind Einstellungen, jede Zelle öffnet ihren eigenen Wähler an Ort und Stelle.

- **`MatrixCellButton`** ist der Wert als stiller Knopf (Zeile 1 der Wert, Zeile 2 leiser, z. B. die Auslöser einer Eskalation); ein Punkt sagt, woher er kommt: Akzent = eigene Einstellung, Gelb = geändert, noch nicht übernommen, kein Punkt = geerbt von Schema oder Projekt. **`MatrixCell`** öffnet darunter ein freies Feld (Formular), eine einfache Liste nimmt `PopoverPick` mit `trigger={<MatrixCellButton …/>}` (jetzt mit `search={false}`, `footer`, `onOpenChange`).
- **`MatrixNote`** ist der Fuß eines Wählers: „Erbt vom Schema „Gemischt““ bzw. „Eigene Einstellung“ mit „Zurücksetzen“. **`MatrixBar`** hält die vorgemerkten Änderungen (klebt unten): „N Änderungen an M Agenten“, „Verwerfen“, „Vorschau und anwenden“.
- **Nichts wird beim Klick geschrieben.** Änderungen liegen im Browser (`features/model-matrix/utils/pending.ts`), der Server nennt in der Vorschau „wirkt auf N Agenten“ mit jedem Wert vorher und nachher, erst „Anwenden“ schreibt (gegen die gelesene Revision). Ändert jemand anderes dazwischen, sagt die Vorschau es in Worten („Zwischenzeitlich geändert · Neu laden“), die Auswahl bleibt. „Rückgängig“ nimmt die letzte Übernahme über die Historie des Servers zurück (`undo` in `apply`, auch nach dem Neuladen): Schema, Profil, Projekt-Schemata und die Rolle und eigenen Werte der Agenten, die diese Übernahme geändert hat; die Historie reicht zehn Übernahmen zurück, jeder Schritt geht eine weiter (`matrix.undo.depth`). Einträge aus der Zeit vor der Agenten-Historie setzen nur das Schema zurück, der Dialog sagt das.
- **Schmal (≤ 900 px):** jede Zeile wird eine Karte mit denselben Wählern (Spaltenkopf als Beschriftung, Werte rechts), Sammelauswahl und Leiste bleiben.
- **Preisliste und Matrix** teilen sich die Seite: die Werkzeugzeile des Preisabschnitts (Suche, Aktualisieren, Preis eintragen) steht in seinem Abschnitt (`LocalChrome` + `Section`), nicht in der Kopfzeile der Seite.
- Roh-IDs erscheinen nie: `utils/modelLabels.ts` macht aus Modell-IDs Namen („Flash (lokal)“, „GPT-6 Sol“), `utils/escalation.ts` liest beide Formen der Eskalation (Richtlinie des Runners und erster Entwurf) und blendet Unbekanntes aus.

## 16. Skill- und MCP-Katalog (Auftrag 138b, 30.09.)

Der Katalog ist keine eigene Seite, sondern Tabs der einen Seite **Einstellungen › Skills** (`TeamAgentSkillsSection`, `?tab=`): Bibliothek (die bisherige Tabelle) · Katalog · Quellen · Vorschläge · Updates; die Katalog-Tabs sieht nur der Team-Inhaber (die API verlangt es). Code in `features/catalog/`, Daten in `services/catalog.service.ts`, Texte im Namensraum `catalog` (10 Sprachen, Test `i18n/catalog.test.ts`).

- **Vorschau** ist das eine `Overlay` rechts mit vier Tabs: Überblick (Befunde als Sätze, Angaben mit `PropertyGrid columns={1}`, Skill-Text formatiert, bei MCP Startbefehl/Umgebung/Zugriffe), Dateien (Skripte markiert, ausgeblendete Geheimnisse als Hinweis), Versionen (`TextDiff`, neue/behobene Befunde, „Auf neue Version prüfen“), Übernehmen (`ScopePicker`: Bibliothek · Projekt · Agent · Rolle mit den vorhandenen Listen, Bestätigung bei Befunden zur Prüfung, gesperrt bei blockierenden, Rückweg mit Bestätigung). Ein Vorschlag eines Agenten öffnet dieselbe Ansicht auf „Übernehmen“ mit dem Grund und der Zuordnung zu genau diesem Agenten.
- **Befunde** (`FindingsView`) sagen je Code einen Satz auf Deutsch (und in allen Sprachen); nur ein unbekannter Code zeigt den technischen Text. Fehler der API (`catalogErrors.ts`) werden in derselben Weise in Sätze übersetzt und an Ort und Stelle als `Notice` (in Listen als eine ruhige Zeile) gezeigt, nicht als Toast.
- **Neue Bausteine im Design-System, jeweils einmal:** `CopyValue` (langer Wert gekürzt, ein Klick kopiert den ganzen), `CodeBlock` (Text in Festbreite), `TextDiff` (aus den Agent-Seiten hierher gezogen, jetzt mit `ds-diff`-Klassen), `PropertyGrid columns={1}` für enge Orte, `ListRow wrap` (Titel ist ein Satz und bricht um) und `ListRow stack` (auf dem Handy stehen Meta und Bedienelement unter dem Text statt ihn zu verdrängen). Die Galerie unter Einstellungen › UI zeigt sie.
- **Grenzen der Anzeige:** Die API kennt kein „zuletzt aktualisiert“ der Quelle; die Quellenliste zeigt Zahl der Einträge und Hinzufügedatum, nach einer Aktualisierung in dieser Sitzung deren Ergebnis. „Kein Update bekannt“ heißt: keine neuere geprüfte Version; erst „Nach Updates suchen“ liest die Quellen und prüft.


## 17. Einheitlichkeit: Kopfleiste, Overlays, Boxen (Owner 30.09.: „Overlays immer gleich, Main-Bereich immer gleich, Top-Bar immer gleich, Elemente immer gleich“)

Plan und Bestandsaufnahme: `docs/ui-konsistenz-refactor.md` (Mac-Doku). Was gilt:

- **Kopfleiste** (`PageHeader`, §2): eine Leiste, Breadcrumb mit Titel als letztem Glied, die Steuerungen der Seite danach, die Hauptaktion rechts, überall dieselbe Höhe und linke Kante.
- **Ein Overlay-Kopf** (`OverlayHead`, 56 px, `--overlay-head-h`): links die Reiter (bei nur einer Sache ein Reiter mit ihrem Namen; das Werkzeug-Panel hat schließbare, ziehbare Reiter und „+“), rechts die eigenen Aktionen (höchstens ein Knopf oder EIN „…“-Menü, `ActionMenu`), dann immer `OverlayControls`: **Als Seite öffnen · Anheften · Vollbild · Schließen** (`data-control="open|pin|full|close"`, 32-px-Knöpfe, 16-px-Symbole). Ihn nutzen das Werkzeug-Panel (`WorkspaceTabBar`), `Overlay` (Aufgabe, Lauf, Agent, Datei, Beleg, Rolle, Team-Projekt, Verwaltung, Webhooks, Runner-Hilfe, Pipeline-Schritt, Dokument-Details, Artefakt, öffentliche Aufgabe), das große Modal (`Modal`, Mein Konto), der Aufgaben-Kopf der Inbox und die Spalte des Artefakts im Chat. Innenabstand aller Overlay-Körper `--overlay-pad` (24 px); `is-flush` nur für Körper, die bis an den Rand gehen (Agenten-Tabs, Chat, Editor).
- **Verhalten:** Esc verlässt zuerst das Vollbild, dann das Overlay (nicht, solange ein Dialog oder Menü darin offen ist). Vollbild vergrößert immer an Ort und Stelle und macht wieder klein; „Als Seite öffnen“ ist ein eigener Knopf. Ein Klick daneben schließt nur Overlays ohne Bearbeitung (Datei-Ansicht, Projekt-Link), nie die Aufgabe (`closeOnOutsideClick`).
- **Anheften** heißt überall: bleibt beim Seitenwechsel offen und die Seite macht Platz (siehe §2); unter 1024 px kein Anheften.
- **Eine Box** für jede Hauptfläche: `surface-1`, Radius 12, Kartenschatten (`--shadow-card`) – `Card`, `ListBox` (Listen in Wissen, Papierkorb, Teamliste, Tabellen `TableCard`, Zeilenlisten `RowList`), Einstellungsgruppen und das Dokument. Lose Zeilen auf dem Seitengrund gibt es nicht; ein Leerzustand steht ohne Box mittig auf der Seite.
- **Eine Einstellungsgruppe:** Titel und ein Satz über EINER Karte (`SettingsGroup`; `SettingsSection` + `SettingsCard` sind dieselbe Optik), volle Breite, Zeilen 56 px.
- **Ein Knopf:** `Button` hat 8 px Radius (`--radius-field`), Pillen nur für Chips und Filter (`radius.test.ts`).
- **Seiten:** Ansichten fügen keinen eigenen Rand hinzu, die Seitenschablone paddet (Tabelle, Liste, Kalender, Ziele hatten einen zweiten). Ein Dokument steht in einer Box mit Verweisen und Verlauf als Karten daneben (`ds-doc-page`).
- **Guards:** `src/app/overlayGuard.test.ts` (kein Sheet, kein handgemachter Scrim/Kopf/680-px-Panel, Ausnahmen mit Begründung), `overlayControlsGuard.test.ts`, `toolbarGuard.test.ts`, `uiAudit.test.ts` (die Regeln des Audits), `utils/dock.test.tsx`, `design-system/layout/Overlay.test.tsx` (Anheften nimmt Platz), `radius.test.ts`. Messung im echten Browser: `apps/web/scripts/ui-audit.mjs` (Kanten > 1 px, Kopfhöhe, Knopfreihenfolge und -größe, Abstand zum Fensterrand, Innenabstand, Esc-Folge, Hauptbereich vor/nach dem Anheften).

## 18. Chat-Sidebar als Organigramm und Sidebar-Breite (O109, O110)

- Die Chats der Sidebar stehen nach der Agenten-Hierarchie (`reportsToAgentId`): Ava oben, darunter
  die Koordinatoren, darunter ihre Spezialisten (`chatAgentTree` in `features/ai-chat/utils/chatSections.ts`,
  gerendert mit dem Design-System-`TreeItem`). Agenten ohne Chats erscheinen nur als Halter eines Astes;
  im Projekt zeigt der Baum nur den Ast der Agenten des Projekts. Die Zahl an einer Zeile ist die
  Chatzahl des ganzen Astes.
- Die Sidebar ist per Ziehen an ihrer Innenkante verstellbar (`SidebarResizeGrip`, der vorhandene
  `ResizeGrip` mit `onReset`, `onDragStart/End` und Werten fuer Hilfstechnik): 200 bis 480 px, die Seite
  behaelt mindestens 560 px, Pfeiltasten 10 px (Shift 50), Doppelklick/Enter = Standard 248 px. Die
  Breite liegt pro Nutzer im Browser (`helena:sidebar-width:<userId>`, `utils/sidebarWidth.ts`).
  Rail, Overlay-Sidebar und Handy behalten den Token `--sidebar-w`.

## 19. Inhalte der Hauptseiten: gleiche Abstände, Hintergründe, Boxen (Owner 30.09.)

Owner: „Die Hauptseiten-Inhalte anschauen: gleiche Abstände, gleiche Hintergründe, gleiche Boxen, sodass alles harmonisch ist.“ Zusammen mit §17 (Kopfleiste, Overlays) ist damit die ganze Seite festgelegt: oben die eine Leiste, darunter dieser Satz Regeln. Alle Werte stehen als Tokens in `tokens.css` („Content boxes“), kein Baustein schreibt eine eigene Zahl.

**Die Regeln (Tokens):**

| Was | Wert | Token |
|---|---|---|
| Seitengrund | `--bg`, immer; keine Seite färbt ihn um | `--bg` |
| Box | `surface-1`, Radius 12, Kartenschatten, **16 px** Innenabstand, **12 px** zwischen den Teilen | `--box-pad`, `--box-gap`, `--radius-card`, `--shadow-card` |
| Enge Box (Kachel im Diagramm, kleine Karte im Raster) | 12 px Innenabstand | `--box-pad-tight` |
| Geräumige Box (Dokument, Ziel-Detail) | 24 px | `--box-pad-roomy` |
| Einschub (Box in einer Box: Notiz, Unterformular) | `surface-2`, Radius 8, kein Schatten | `--radius-md` |
| Abstand zwischen Boxen (untereinander UND nebeneinander) | **16 px** | `--stack-gap` |
| Abstand zwischen Abschnitten (Titel + Inhalt) | **32 px** | `--section-gap` |
| Abschnittstitel → seine Box | 12 px | `--section-head-gap` |
| Abschnittstitel | 15 px / 520 (`Section`, `SettingsGroup`, `SettingsSection`), optional ein Satz 13 px darunter | |
| Kleinbeschriftung (Widget-Name, Gruppenkopf, Spaltenkopf, Kachel-Name) | Mono 10 px, Großbuchstaben, Sperrung `--label-tracking` | `--label-size` |
| Gruppenkopf über einer Liste | 32 px hoch, Kleinbeschriftung + Zähler (`GroupHead`) | |
| Leerzustand | immer mit Symbol (Vorgabe: Ablage), ein Satz, optional Titel und Aktion; der der Seite steht in einem Block von 60 vh, damit das Symbol überall an derselben Stelle sitzt; in einer Box (`boxed`) kompakt | |
| Hell und dunkel | dieselben Stufen: Grund `bg`, Box `surface-1`, Einschub/Hover `surface-2`, Auswahl `surface-3` | |

**Bausteine (alle in `@/design-system`, jeder Rahmen aus genau einem):**

- **`Card`** ist DIE Box: `title` (13/520) oder `eyebrow` (Kleinbeschriftung, für Widgets/Kacheln), `meta`, `actions`, `pad` (`normal` 16 · `tight` 12 · `roomy` 24 · `list` 4 für Zeilen mit eigenem Hover · `none` für Tabellen mit eigenen Zellen), `gap`, `layout="row"`, `as` (section, article, li, ul, `Link`, `button`), `interactive`, `selected`, `headingAs`, `tooltip`. Töne: `inset` (Box in Box), `node` (Karte fester Größe im Diagramm, Inhalt mittig, `selected` = Akzentring; Organigramm-Knoten), `popover` (schwebende Karte, Overlay-Schatten; Hover-Karte). Kacheln (`Tile`, `ProjectTile`), Dashboard-Abschnitte, Inbox-Karten, Startseiten-Karten, Ziele, Agenten-/Abteilungskarten, Workflow-Karten sind alle `Card`.
- **`ListBox`** (Listen, mit `padded` 4 px Luft, Zeilen bekommen Radius 8), **`TableCard`** (ist eine `ListBox`), **`RowList`** (Zeilenliste mit `SectionLabel`), **`SettingsGroup`/`SettingsRow`** (+ `SettingsSection`/`SettingsCard`, dieselbe Optik) zeichnen dieselbe Box. Eine Liste, die selbst scrollt, steht in der `ListBox`, die Zeilen in einem Kind mit `overflow-y-auto` (die Box schneidet ab, `overflow-*` auf ihr selbst greift nicht).
- **`Section`** (Titel, Satz, Aktionen; Inhalt mit `--stack-gap`), **`Sections`** (mehrere Abschnitte untereinander, `--section-gap`), **`GroupHead`**, **`MonoLabel`/`MonoMeta`**, **`EmptyState`** (`fill` / `boxed`), **`Notice`** (getönte Hinweise, Radius wie die Box; `tone` neutral/warning/danger, Text darf Absätze und Listen enthalten; ersetzt das frühere shadcn-`Alert`).
- **Kleine Bausteine, die sonst jede Seite selbst gerahmt hätte:** `Pill` (`size="sm"` = 20 px für das Etikett in einer dichten Zeile, `tone`), `PillButton`, `PillLink` (ein Chip, der klickt oder verlinkt); `IconTile` (32-px-Kachel mit dem Symbol einer Zeile: Login, Werkzeug, Skill, Verbindung); `FieldFrame` (Rahmen eines Feldes mit mehr als einer Eingabe: Tags, Empfänger, Editor; `area` für den Editor-Block; gleiche Fläche, gleicher Radius, gleicher Fokus wie `TextField`); `CodeBlock` (jeder Befehl, Log und Rohtext in Mono, nie ein eigenes `<pre>`); `CopyValue` (ein Wert, der mit einem Klick kopiert wird); `TextArea` (das Mehrzeilenfeld). Ein Karten-Knopf ist `Card as="button"` (`interactive`, `selected`, `disabled`), ein Karten-Link `Card as={Link}`, eine Auswahlkarte im Dialog `tone="inset"`.
- **Split-Flächen:** `.ds-pane` (Liste neben Detail: Inbox, Mail, Dokumentbaum; Fläche `surface-1`, Linie zur Nachbarfläche, unter 768 px ohne Linie), `.ds-sticky-head` (Kopfzeile einer scrollenden Tabelle).
- `DashboardPrimitives` hat keine eigene Karte, kein eigenes Label mehr: `Card`, `MonoLabel`, `MonoMeta` sind Re-Exporte des Design-Systems.

**Der Orb und was darunter scrollt:**

- *Handy (< 900 px):* Er sitzt in der Kopfleiste am rechten Ende (52-px-Fläche, der Partikel-Orb zeichnet sich in ~70 % davon) statt unten rechts über der Seite; die Leiste hält den Platz frei (`.ds-page-header::after`), sodass er nie Titel, Steuerungen, Listenaktionen oder das Eingabefeld verdeckt.
- *Desktop (≥ 900 px):* Er schwebt unten rechts (64 px, 24 px vom Rand) und verdeckt beim Scrollen nichts. **An einer Stelle:** `HomeDock` ruft `useOrbClearance` (`utils/orbClearance.ts`); der Hook fragt mit `elementsFromPoint` an einem Gitter aus 4 × 4 Punkten über dem Orb, welche Scroller (`overflow-y: auto|scroll`, die überlaufen) unter ihm liegen, und markiert sie mit `data-orb-clear`. Ein markierter Scroller endet mit einem leeren Stück in Höhe des Orbs (`[data-orb-clear]::after`, `--orb-clear` 96 px in `shell.css`), seine letzte Zeile scrollt also frei. Das gilt für jede Seite, Liste und Tabelle, keine Seite polstert sich selbst; eine Seite, die nicht überläuft, bekommt nichts (das Ende gilt nicht als Inhalt, sie scrollt nie wegen des Orbs). Neu gemessen wird bei Routenwechsel, Größenänderung und Änderungen im Hauptbereich (gedrosselt). Er fehlt weiter auf Start (dort ist er die Seite), im Terminal und bei offenem Panel.
- Messung: `ui-audit.mjs` (`measureOrb`, `orbFindings`) verkleinert das Fenster auf 600 px Höhe, scrollt jeden Scroller ans Ende und meldet alles, was zu lesen oder zu klicken ist und unter dem Orb liegt (große Flächen wie eine Ablagezone zählen nicht). Getestet in `utils/orbClearance.test.ts` und `uiAudit.test.ts`.

**Nicht mehr erlaubt (Guard):**

- In Seiten und Features (`features/**`, `app/**`) sperrt ESLint die Klassen `bg-card`, `bg-popover`, `border` (ganzer Rahmen) und `shadow-*` (`better-tailwindcss/no-restricted-classes`); zusammen mit den schon gesperrten Radien, Abständen und Schriftgrößen kann eine Seite keine eigene Box zeichnen. Bestand steht in `eslint-suppressions.json` und wird nur kürzer (`bunx eslint --prune-suppressions .`).
- `src/design-system/boxGuard.test.ts`: kein Modul-CSS und kein Feature-CSS setzt `--shadow-card`, `Card`/`Tile` werden nicht nachgebaut.
- Messung im echten Browser: `apps/web/scripts/ui-audit.mjs` misst jede Route (hell/dunkel, 1440/390) auf Seitengrund, jede Box (Radius, Hintergrund-Token, Schatten, Innenabstand der Karten), handgemalte Boxen (Rahmen + Füllung ohne Box-Klasse), den Abstand nebeneinanderliegender Boxen (16 px), den Abstand der Abschnitte in `Sections` (32 px), das Symbol jedes Leerzustands samt seiner Lage und die Schriftgrößen der Titel (`contentFindings` in `ui-audit-rules.mjs`, getestet in `uiAudit.test.ts`).

**Umstellung:** Runde 1: 70 handgemalte Karten (`rounded-md border bg-card`) per Codemod auf `Card` (Radius 8 + Rahmen wurde Radius 12 + Kartenschatten). Runde 2 (Codemod `card-codemod.mjs` mit `CARD_ANY_BORDER`, dazu Handarbeit): `bg-card` in `src` 78 → 2 Stellen (übrig: der Anhangs-Chip `ui/attachment.tsx` und die Kopfzeilen-Konstante `WorkspaceHeader`, deren Test die Klassen prüft), Rahmen und Schatten in `features/**` und `app/**` 259 → 20 Stellen (gezählt über `features/**` und `app/**`, Klassen `bg-card`, `bg-popover`, `border`, `shadow*`). Was blieb, sind Bedienelemente und Schwebendes: Auswahlpunkte und Farbmuster (`rounded-full border`), Haftnotiz und Kanban-Geisterkarten, Popover/Toast-Schatten, das Etikett am Browser-Bild. Doppelte Bausteine sind weg: `components/ui/card.tsx` und `components/helena/Card.tsx` (nirgends benutzt), `ui/alert.tsx` (→ `Notice`), `ui/table.tsx` (nirgends benutzt), `TableCard` zeichnet die `ListBox`, `common/fields/Pill` ist der `PillButton`. `eslint-suppressions.json`: 5884 → 5228 Zähler, 878 → 868 Dateien.

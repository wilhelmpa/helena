# Entscheidung: Layout-Wahl für Seite und Werkzeuge (Layout-Selector)

Datum: 2026-09-24 · Branch: `hub/layout` · Status: entschieden

## Der Auftrag

Owner, 2026-09-24: „im dual mode muss der chat nach links damit ich den browser oder so sehen kann oder irgendwie clever die ui anpassen, das ich so verschiedene sachen gleichzeitig nebeneinander haben kann, oder so eine art layout selector“.

Bisher gab es genau eine Anordnung: die Seite links, das Werkzeug-Panel rechts (auf dem Dual-Kiosk fest auf dem zweiten Bildschirm), dazu im Panel eine geteilte Ansicht (`splitTool`) und einen Vollbild-Schalter. Der Chat lebte im Panel. Wer chattete, sah deshalb den Browser nicht.

Gebraucht wird:
- **Mehrere Dinge nebeneinander.** Seite, Chat und ein Werkzeug gleichzeitig, frei kombinierbar.
- **Ein einfacher Wähler.** Ein Knopf in der Kopfzeile mit kleinen Bildern der Layouts, keine Einstellungsseite.
- **Layouts als Daten an einem Erweiterungspunkt.** Plugins liefern eigene Layouts, und Plugin-Werkzeuge passen in jeden Bereich (§3a der OSS-Planung).
- **Nichts lädt neu.** Wenn ein Werkzeug den Bereich oder das Layout wechselt, bleiben Terminal-Sitzung, code-server, Browser-Ansicht und die offene Unterhaltung im Chat erhalten.
- **Bildschirmgenau auf dem Dual-Kiosk.** Der zweite Bildschirm ist genau die Hälfte des Fensters (`50vw`).

## Der entscheidende technische Punkt

Ein `<iframe>`, das im DOM umgehängt wird, lädt neu. Das gilt auch, wenn es nur in ein anderes Elternelement wandert (HTML-Standard: Entfernen aus dem Dokument beendet den Browsing-Kontext). Die Werkzeuge in Helena sind fast alle Frames: Terminal (ttyd), Code (code-server), Browser (VNC-Desktop) und Plugin-Seiten. Der Chat ist eine React-Komponente. Seine offene Unterhaltung ist lokaler Zustand, der beim Neu-Einhängen verloren geht.

Jede Bibliothek, die Bereiche als verschachtelte Container rendert, hängt deren Inhalt beim Umordnen um. Dockview nennt das Problem ausdrücklich und löst es mit dem Renderer `always`: Die Inhalte bleiben in einer eigenen, flachen Ebene und werden nur über ihre Bereiche gelegt. VS Code macht es bei Webviews genauso (overlay webviews).

## Kandidaten

| | Was es ist | Lizenz / Pflege | Passung |
|---|---|---|---|
| **react-resizable-panels** (bvaughn; shadcn „Resizable“) | `Group`/`Panel`/`Separator`, Größen in px oder %, Tastatur und ARIA | MIT, v4.13, sehr verbreitet | Gut für ziehbare Trenner. Aber: „Panel elements must be direct DOM children of their parent Group“. Jedes Werkzeug sitzt also *in* seinem Panel. Wandert es in einen anderen Bereich, wird es umgehängt und lädt neu. Prozentgrößen verschieben sich beim Server-Rendern. Den Kiosk-Bildschirm als festes `50vw` bildet es nicht direkt ab. Im Repo ist es noch nicht vorhanden. |
| **dockview** | vollständiger Docking-Manager: Tabs, Gruppen, Ziehen und Ablegen, schwebende Gruppen; Renderer `always` gegen iframe-Neuladen | MIT (Kern); seit 8.0 zusätzlich „dockview-enterprise“ unter kommerzieller Lizenz | Löst das iframe-Problem, bringt aber eine zweite Bedienwelt mit: Tabs, Ziehen und eigene Themes. Der Owner will „clever und einfach“ und eine einheitliche Oberfläche (ui-standard). Undo und angeheftete Tabs gibt es nur in der Enterprise-Ausgabe. Für fünf feste Anordnungen ist das zu schwer. |
| **flexlayout-react**, **golden-layout**, **react-mosaic** | Docking- und Kachel-Manager mit Tabsets | MIT / MIT / Apache-2.0 | Gleiche Einwände wie bei dockview. Mosaic hängt beim Umordnen um. |
| **allotment** (VS-Code-SplitView als React) | Split-Ansichten mit Trennern | MIT | Verschachtelte Container, also das gleiche Umhänge-Problem wie bei react-resizable-panels. |
| **CSS Grid + vorhandener `ResizeGrip`** (gewählt) | ein Grid pro Layout: je Bereich eine Spalte; Seite, Kopfzeilen und Werkzeug-Ansichten als *flache, stabile* Grid-Elemente, die nur ihre Spalte wechseln | Web-Standard; `ResizeGrip` ist Helenas vorhandener WAI-ARIA-Separator mit Tastatur | Nichts wird umgehängt, also lädt nichts neu. Das ist dasselbe Prinzip wie dockviews `always`, nur ohne Overlay-Messung. Spalten in px, `1fr` und `50vw` treffen den Kiosk-Bildschirm genau. Kein neues Paket. |

## Entscheidung

**CSS Grid mit flachen, stabilen Elementen, dazu der vorhandene `ResizeGrip` und `usePersistedWidth`. Keine neue Bibliothek.**
- Der Host (`components/layout/WorkspaceLayoutHost.tsx`) ist ein Grid mit zwei Zeilen (40px Bereichs-Kopfzeile, Rest) und einer Spalte je Bereich.
- Die Seite, die Kopfzeilen der Bereiche und alle Werkzeug-Ansichten sind direkte Kinder dieses Grids. Ein Layoutwechsel ändert nur `grid-column`/`grid-template-columns`. Versteckt wird mit `display: none`, das lädt ein iframe nicht neu.
- Für ein schwebendes Panel (Standard-Layout, Modus „überlagern“, Telefon) läuft die Seite unter dem Panel über alle Spalten. Die Panel-Elemente liegen per `z-index` darüber.
- „Werkzeug groß“ legt den Host mit `fixed inset-0` über das ganze Fenster, auf dem Dual-Kiosk also über beide Bildschirme.
- Geprüft im Headless-Chrome: Ein Frame lädt beim Wechsel zwischen „Chat links“, „Chat + Werkzeug“ und zurück genau einmal (Resource Timing). Der Frame füllt seinen Bereich pixelgenau aus: 620 × 812, 1920 × 992 und 960 × 992 an den geprüften Größen.

Verworfen wurde react-resizable-panels. Das ist keine Kritik an der Bibliothek: Ihr Modell „Inhalt im Panel“ widerspricht der Anforderung „Werkzeuge wandern, ohne neu zu laden“. Sollte Helena später frei ziehbare, verschachtelte Anordnungen brauchen, ist dockview mit Renderer `always` der Kandidat. Die Layout-Registry bliebe dabei dieselbe.

## Erweiterungspunkt

- **SDK:** neuer UI-Slot `workspace-layout` in `@helena/sdk` (`WorkspaceLayoutSlot`, `WorkspaceLayoutArea`). Ein Layout ist reine Daten: Bereiche mit `shows: 'page' | 'main' | 'tool'`, `side: 'page' | 'panel'`, optional `tool` (Startwerkzeug bzw. Ausweichwerkzeug) und `minRoom` (unter dieser Fensterbreite fällt der Bereich weg). Dazu `full` für „alles“. Ein Plugin meldet sein Layout über `ctx.uiSlots.register({ slot: 'workspace-layout', … })` und im Manifest unter `provides.uiSlots`.
- **Web:** Die Registry `extensions/workspaceLayouts.ts` nach dem Muster von `panelTools.tsx` prüft jedes Layout beim Registrieren (`layoutProblem`): genau ein Hauptbereich, die Seite höchstens einmal, und zwar auf der Seitenseite.
  - Die eingebauten Layouts kommen als internes Plugin `helena.layout`.
  - Plugin-Layouts kommen über `/plugins/ui-slots` (`extensions/pluginWorkspaceLayouts.ts`) unter der Id `plugin:<pluginId>:<id>`. Kurze Werkzeug-Ids eines Plugins werden zu `plugin:<pluginId>:<tool>`.
- **Logik ohne React:** `utils/workspaceLayout.ts` enthält `resolveWorkspaceLayout`, `layoutGeometry`, `pickAreaTool` und `nextLayoutId`, mit Unit-Tests.
  - `resolveWorkspaceLayout` bestimmt, welcher Bereich jetzt was zeigt.
  - Die Regel „jedes Werkzeug nur einmal“ gilt in dieser Rangfolge: erst die Seite, die selbst ein Werkzeug ist (Chat-Seite), dann Bereiche mit eigenem Werkzeug, dann der Hauptbereich. Ein angedockter Chat tritt neben der Chat-Seite zurück.
- **Zustand:** `hooks/useWorkspaceLayout.ts` liegt über dem bisherigen `useWorkspacePanel`. Das Panel behält `open`/`activeTool`/`mode`. Die frühere geteilte Ansicht und der Vollbild-Schalter *sind* jetzt die Layouts „Zwei Werkzeuge“ und „Werkzeug groß“. Es gibt keinen parallelen Mechanismus, und die alten Schlüssel werden einmalig übernommen.
- **Speicherung:** pro Gerät in localStorage (`workspace:layout:kiosk-dual|kiosk-single|browser`), gelesen über `useSyncExternalStore` (`hooks/useLocalValue.ts`). Ist der Speicher gesperrt, gilt die Wahl im Arbeitsspeicher bis zum Neuladen. Auf dem Server und bei der Hydration gilt immer „Standard“.

## Eingebaute Layouts

| Id | Name | Bereiche |
|---|---|---|
| `standard` | Standard | Seite \| Werkzeug. Das Panel öffnet und schließt sich und kann überlagern, wie bisher. |
| `chat-left` | Chat links | Seite \| Chat (angedockt, Breite ziehbar und gespeichert) \| Werkzeug (Startwert Browser). Unter 1600px Fensterbreite ersetzt der Chat die Seite. Dual: linker Bildschirm Seite + Chat, rechter Bildschirm Werkzeug. |
| `chat-tool` | Chat + Werkzeug | Chat statt Seite \| Werkzeug |
| `two-tools` | Zwei Werkzeuge | Seite \| Werkzeug \| Werkzeug (Startwert Terminal). Jede Hälfte hat ihre Werkzeugwahl. |
| `tool-full` | Werkzeug groß | ein Werkzeug über das ganze Fenster (Dual: beide Bildschirme), mit dem Knopf „Zurück“ zum vorigen Layout |

Auf dem Telefon (< 768px) gilt immer „Standard“ (eines nach dem anderen), und der Wähler ist ausgeblendet.

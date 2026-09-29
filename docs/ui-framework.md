# Helena UI-Framework

Stand 28.09.2026 (hub/ui-2). Verbindlich für jede Seite, jedes Feature und jedes Plugin. Grundlage: `docs/design-system.md` (Werte), `docs/ui-befunde-2026-09-28.md` (Owner-Befunde) und `docs/volition-helena-oss.md` §3a (Helena als Framework).

**Grundregel (Owner):** Alles wird aus Komponenten gebaut, niemand schreibt eigene Styles. Fehlt etwas, wird es als Komponente oder Variante ergänzt, nicht inline.

## 1. Öffentliche API

Es gibt einen einzigen Einstieg: `@/design-system` (`apps/web/src/design-system/index.ts`). Seiten, Features und Plugin-Slots importieren nur von dort.

| Bereich | Bausteine |
|---|---|
| Tokens | `tokens.css`: Farben hell/dunkel, Abstände `--space-1…7`, Radien `--radius-sm/md/lg/xl/full`, Seitenmaße. Tailwind liest dieselben Werte (`globals.css` `@theme`). |
| Layout | `Page` (Seitenschablone), `PageToolbar`, `PageTabs`/`Tabs`, `PageSearch`, `PageSelect`, `PageActions`, `SidePanel`, `Overlay`, `Modal`, `Dialog` |
| Anordnung | `Stack`, `Inline`, `Grid`, `Box` (Abstände nur aus der Skala), `Text` (Schriftgrößen und Töne) |
| Bausteine | `Card`, `List`/`ListGroup`/`ListRow`, `Table`/`Th`/`Tr`/`Td`, `Pill`/`Badge`, `PillButton`, `Segmented`, `Button`/`ButtonLink`/`IconButton`, `TextField`/`TextArea`/`SearchField`/`Field`, `Switch`, `EmptyState`, `Menu…`, `ActionMenu`, `Tip`, `NameList`, `StatusDot`, `StatusPill`, `Orb`, `LocalChrome` |
| Muster | `SettingsGroup`/`SettingsRow`, `FilterBar` (in `@/components/layout/FilterBar`, liest Projektdaten), `DetailView`/`DetailHeader`/`DetailGroup`/`PropertyGrid`, `Section`, `MonoLabel` |

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

| Token / Klasse | Wert | Wofür |
|---|---|---|
| `--radius-sm` / `rounded-sm` | 6 px | Chips, Badges, kleine Marken |
| `--radius-md` / `rounded-md` | 8 px | Buttons, Eingabefelder, Bedienelemente |
| `--radius-lg` / `rounded-lg` | 12 px | Karten, Zeilen, Menüs |
| `--radius-xl` / `rounded-xl` | 16 px | Panels, Dialoge, Overlays |
| `--radius-full` / `rounded-full` | voll | Pillen, Avatare, Punkte |

eslint lehnt alle anderen `rounded-*`-Klassen ab (`rounded`, `rounded-xs`, `rounded-2xl`, `rounded-[…]`). Der Test `src/design-system/radius.test.ts` prüft `border-radius` in CSS und `borderRadius` in Style-Objekten.

## 5. Abstände und Schrift

In `features/**` und `app/**` sind Tailwind-Klassen für Abstände (`p-4`, `gap-2`, `space-y-3`, `mt-1` …), Schriftgrößen (`text-sm` …) und Radien verboten. Stattdessen:

- `Stack gap={3}` (untereinander), `Inline gap={2} justify="between" wrap` (nebeneinander), `Grid min="card"` bzw. `Grid columns={2}` bzw. `Grid split`, `Box pad={4}`. `Grid min="fit"` teilt eine Zeile unter beliebig vielen Karten auf (Kennzahlen des Dashboards), auf dem Handy zweispaltig.
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

| Funktion | Ort | Baustein |
|---|---|---|
| Budgets, Drossel, harter Stopp | Projekt › Einstellungen › Agenten › **Autopilot & Ausführung** (Überschreibung, markiert, „Auf Vorgabe zurücksetzen“); Vorgabe unter **Vorgaben für Projekte** (`DefaultBudgetsGroup`, gilt für neue Projekte); Anzeige: Dashboard-Kachel „Budgets“, Projektkarten, „Braucht dich“ (aufgebraucht = gestoppt, ab 80 % = gedrosselt) | `SettingsGroup` „Budgets“, `BudgetsTile`, `budgetNeedsYouSource` |
| Dauerhafte Anweisungen | Projekt › **Autopilot & Ausführung** (Gruppe „Anweisungen“ mit den Projektanweisungen); für Helena unter **Vorgaben für Projekte**; Vorschläge der Agenten übernehmen/ablehnen | `StandingOrdersGroup` |
| Eskalation | **Agenten und Modelle** (zentrale Regeln, als „Vorbereitet“ markiert, bis die zentrale Laufzeit sie befolgt); Agent-Dialog › Modell & Verhalten nur „Festlegung für diesen Agenten“ | `LocalAiEscalationSection`, `AgentEscalationPin` |
| Telegram-Kanal | **Benachrichtigungen & Kanäle** › Telegram | vorhanden |
| Heartbeat, Gedächtnis, Fakten, Skills pro Agent | Agent-Detail (Agent-Dialog); der Herzschlag zeigt Vorprüfung, Drossel und die letzten Prüfungen gebündelt, der Verlauf bündelt Herzschlag-Läufe | `DetailView`, `SettingsGroup`, `List` |
| Skills, Selbstlernen | **Skills** (Katalog) | vorhanden |
| Ziel-Leiter | Ziele-Seite und Aufgabendetail | `DetailGroup` |
| Sitzungssuche | globale Suche (⌘K) | Befehlspalette |

## 9. Abnahme

Pro Paket eine Klick-Abnahme im echten Browser über alle betroffenen Seiten: hell und dunkel, Desktop 1440 und Handy 375, Konsole ohne Fehler. Was nicht funktioniert, wird repariert oder verschwindet aus der UI.

Der Einstieg `@/design-system` ist reine Darstellung: Er zieht keinen API-Client, keine Dienste und keine Datenhooks nach sich (Test `design-system/barrel.test.ts`). Komponenten, die Daten lesen (Composer, Agentenwahl, FilterBar mit Projektdaten), liegen außerhalb und bauen selbst auf dem Framework auf.

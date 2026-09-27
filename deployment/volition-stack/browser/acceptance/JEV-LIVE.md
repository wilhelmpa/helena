# Native JEV-Browserabnahme auf der eigenen Testseite

Vorbereitet gegen `ee2ecb3fdd4d013ae7902000c33a7e4f799a6064`, 26.09.2026.
**Noch nicht ausgeführt.** Root führt diesen Ablauf erst nach dem seriellen
Browser-Deployment und dessen vollständigem Gate aus. Verbindung 46 hat bereits
echte synthetische Inferenz geliefert; das ersetzt diese Browserabnahme nicht.
Keine neue Runtime, Installation, Anmeldung oder Schlüsselkopie ist erforderlich.

## 1. Projekt und bestehenden Tab festhalten

- Das durch [Punkt 6](../../integration/acceptance/README.md) angelegte eigene
  `P6BROW26` / `p6brow26` verwenden. Projekt-ID, Team-ID und dessen Browser-Agent-ID
  aus der normalen UI festhalten; keine ID vermuten und keinen Home-/VOL-Agenten
  verwenden. Setup muss erfolgreich sein, der Agent betriebsbereit. Keine Routine
  aktivieren oder bestehende Agenten umkonfigurieren.
- [Browser-README](README.md), Abschnitte „Stage the observer safely“ und „Serve
  the own synthetic fixture“, durchführen: bestehende unterstützte Preview,
  `fixture.html`, tatsächliche URL aus `preview_status`/`preview_url`, **ein eigener
  bestehender Tab**. Bei bereits erfolgreicher Reconnect-Abnahme denselben Tab
  weiterverwenden. Keine User-Tabs schließen, keinen neuen Tab während der Probe
  anlegen. Die geprüfte Observer-Version mit `compare-task` verwenden; Hash und
  deployed HEAD protokollieren.
- In der sichtbaren Helena-Projektansicht bestätigen: nur die synthetische Seite,
  Name leer, „Fixture ready“, Counter merken. Für diese Phase nichts manuell
  anklicken/eintippen. Vorherige Fixture-Daten gegebenenfalls **vor** der Baseline
  durch bewusstes Neuladen nur dieses eigenen Tabs zurücksetzen; das ist keine
  Reconnect-Abnahme. Die Reconnect-Phasen selbst bleiben separat.
- Owner-Session verwenden. Die folgenden API-Pfade sind relativ zur vorhandenen
  API-Basis des Webclients; keine Tokens auslesen, neue Schlüssel ausstellen oder
  `/internal/*`-/Gateway-Service-Routen direkt aufrufen.

## 2. Nur P6BROW26 auf die vorhandene Verbindung einstellen

UI: `/project/P6BROW26/settings/browser` → **Browser-Steuerung**.
Zuvor `GET /projects/P6BROW26/settings/browser-control` als kleine Ausgangskonfiguration
sichern. `GET /projects/P6BROW26/browser-lab/options` nennt die tatsächlich verfügbaren
Browser-Agenten und Connections. Nur wenn Verbindung **46** dort enthalten ist,
„Entscheidungsmodell“, Verbindung 46, Policy „Jev“ wählen. Normaler API-Gegenwert:

```json
{"mode":"decision","credentialId":46,"policy":"jev","minConfidence":null}
```

`PUT /projects/P6BROW26/settings/browser-control`; anschließend GET prüfen:
`effective.enabled=true`, `source=project`, `policy=jev`, `credentialId=46`,
`problem=null`. Fehlt die Verbindung/Agentenfähigkeit: Setup-Blocker melden.
Keine globale Einstellung und keine Credential-Konfiguration ändern.
`allowLocalAddresses=false` sowie die vorhandenen Privacy-/Domain-/Task-Guards
beibehalten; nur die registrierte eigene Preview hat die enge Ausnahme.
Ein weiterer „Verbindung testen“-Aufruf ist hier nicht nötig.

## 3. Vier einzelne native Tool-Aufrufe, keine automatischen Folgeschritte

UI: `/project/P6BROW26/chat?agent=AGENT_ID`. Einen eigenen synthetischen Chat verwenden.
Jede Phase einzeln senden und die **tatsächlich ausgeführten Tool-Argumente** prüfen:

> Führe ausschließlich genau einen Aufruf `browser_task` mit dem folgenden JSON
> im bereits offenen P6BROW26-Fixturetab aus. Keine Navigation, neuen Tabs,
> Einzelschritt-Werkzeuge, zusätzlichen Modellprüfungen, Wiederholung oder autonome
> Fortsetzung nach Rückgabe. Gib danach Status und die vorhandene Run-ID zurück.
> Bei Handback nur die Unklarheit nennen, keine Auswahl erfinden.

`FIXTURE_URL` durch die überprüfte eigene URL ersetzen. `startUrl` und
`allowIrreversible` weglassen. Nach jeder Phase erst Ergebnis/Verbrauch prüfen.
Die Browser-Ansicht darf zuschauen, der Owner übernimmt währenddessen nicht die
Steuerung. Root-CDP beobachtet ausschließlich mit dem bestehenden Observer.

**A — echte Auswahl, Eingabe und unabhängig bestätigter Erfolg:**

```json
{"goal":"Fill Name with Ada Proof and press Verify fixture. The page must show Fixture accepted Ada Proof.","values":{"name":"Ada Proof"},"mode":"act","maxSteps":4,"success":{"url":"FIXTURE_URL","textIncludes":["Fixture accepted Ada Proof"],"fields":[{"label":"Name","value":"Ada Proof"}]}}
```

Vorher/nachher mit dem bereits root-sicher gestagten Observer kleine Berichte
`jev-before.json` / `jev-after.json` erzeugen:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" snapshot p6brow26 "$fixture_url" > jev-before.json
# Hier ausschließlich Phase A durch den normalen Helena-Agenten ausführen.
env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" snapshot p6brow26 "$fixture_url" > jev-after.json
```

Pass: native Run-Zeile `source=agent`, `backend=decision`, `policy=jev`, richtige
Agent-/Projekt-/Credential-ID; echte erfolgreiche Entscheidungen mit gemeldetem
Modell; Schritte enthalten `TYPE_TEXT` am Name-Feld und `CLICK` auf „Verify fixture“;
Status **`done`**. Frisches sichtbares Bild zeigt Name und Erfolgstext. Unabhängiger
Observer: vorher `nameMatches=false, accepted=false`, danach beide `true`, gleicher
Target/Document/timeOrigin, eine Seite, Counter unverändert. `compare` ist für
Reconnect (+1 Counter) und **nicht** für diese A-Prüfung gedacht. Exakter Vergleich
der zwei eigenen Reports mit dem geprüften Observer:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" compare-task jev-before.json jev-after.json
```

**B — Legacy-Caller darf keinen verifizierten Erfolg behaupten:**

```json
{"goal":"Confirm the already visible Fixture accepted Ada Proof result. Do not change anything.","mode":"read","maxSteps":1}
```

Erwartet bei modellseitig bestätigter Fertigstellung: terminal **`likely_done`**,
Snapshot, kein weiterer Tool-Aufruf, keine verändernde Aktion. `done` ohne
`success` wäre ein Fehler. Wählt das Modell keinen Abschluss, tatsächlichen
begrenzten Status dokumentieren; die `likely_done`-Livezelle bleibt unbewiesen.

**C — bewusst falsches Erfolgskriterium:**

```json
{"goal":"Confirm the already visible Fixture accepted Ada Proof result. Do not change anything.","mode":"read","maxSteps":1,"success":{"url":"FIXTURE_URL","textIncludes":["HELENA_PROOF_IMPOSSIBLE_20260926"]}}
```

Niemals `done`; bei DONE-Behauptung des Modells `needs_agent` mit ungeprüften
Kriterien und Snapshot. Anderer begrenzter Stop belegt nur, dass kein Erfolg
falsch bestätigt wurde, nicht das Erreichen genau dieses DONE-Zweigs.
Sichtbare Seite, Counter und Name bleiben unverändert.
Für B, C und D jeweils eigene Vorher-/Nachher-Reports aufnehmen und prüfen:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" compare-unchanged phase-before.json phase-after.json
```

Dieser Vergleich belegt nur unveränderte Fixture-Prüffelder im selben Dokument.
Zusätzlich die nativen Schritte prüfen: Eine erfolglose oder rückgängig gemachte
Aktion kann trotz unveränderter Prüffelder stattgefunden haben.

**D — unklare Auswahl an den zwei vorhandenen Fixture-Buttons:**

Nur am Testprojekt `minConfidence:0.95` setzen, GET bestätigen. Der native Guard
vergleicht die **Zielwahrscheinlichkeit** mit diesem Schwellwert; das ist nicht
das Modellfeld `confidence`. Nicht `1` verwenden: `policyOf` akzeptiert einen
Override nur strikt zwischen 0 und 1, sonst gilt der Policy-Default.

```json
{"goal":"Click the one of the two buttons that the operator selected privately. The selection was not supplied. Do not guess or click either button without that information.","mode":"act","maxSteps":1,"success":{"url":"FIXTURE_URL","textIncludes":["HELENA_PROOF_OPERATOR_CHOICE_CONFIRMED"]}}
```

Pass für sichere Rückgabe: keine ausgeführte Click-/Type-/Select-/Enter-Aktion,
unveränderte Seite und `needs_agent` mit Grund/Snapshot/Kandidaten. Nur wenn der
Grund tatsächlich geringe Zielsicherheit nennt, ist der **Low-confidence-Zweig**
live erreicht. `stuck`/`blocked`/`max_steps` ohne Aktion sind ein sicherer begrenzter
Stop, aber kein Nachweis dieses speziellen Zweigs. Eine dennoch ausgeführte Aktion
ist ein negativer Befund — auch wenn ihr sichtbarer Effekt gleich bleibt.
Das echte Modell ist nicht deterministisch: keinen erhofften Status erfinden,
keinen Mock als Live-JEV ausgeben, nicht bis zum gewünschten Ergebnis wiederholen.
Der vorhandene isolierte Low-confidence-Test bleibt der deterministische Beleg.

## 4. Begrenzung und kleine, prüfbare Belege

- Genau vier `browser_task`-Aufrufe, ohne `browser_check`/`browser_choose` und ohne
  zusätzlichen Lab-/Connection-Test. Die lokale Schleife erlaubt `2*maxSteps+2`
  Entscheidungen: **10 + 4 + 4 + 4 = höchstens 22** erfolgreiche Roundtrips.
  Die API hat zusätzlich den gröberen `2*maxSteps+8`-Schutz. SDK: 20 s Timeout,
  höchstens ein Retry auf 429/529; Transportversuche können daher zahlreicher sein.
- Operator-Abbruchmarke: 120 s pro Phase; dann normalen Run-Abbruch und bei Bedarf
  Owner-Übernahme verwenden, keinen Service-Neustart. `POST
  /projects/P6BROW26/browser-lab/runs/RUN_ID/cancel` setzt ein Cancel-Flag; es ist
  **kein garantierter Sofortabbruch** einer bereits laufenden Provideranfrage.
  Keine weitere Phase starten, solange dieser Run/Chat noch aktiv ist.
- Nach jeder Phase kumulierte Eingabe-/Ausgabetokens prüfen. Operator-Budget:
  20.000 Input / 4.000 Output für die ganze Abnahme; bei Erreichen keine nächste
  Phase. Diese Prüfung ist nachgelagert, **kein harter Token-/Euro-Cap pro Anfrage**.
  Fehlende Zähler als unbekannt, nicht als kostenlose Inferenz verbuchen.
- UI-Belege: `/project/P6BROW26/browser-lab` listet auch Agent-Tasks. Einzelne
  bekannte Run-ID über `GET /projects/P6BROW26/browser-lab/runs/RUN_ID` lesen.
  Speichern: ID, `source/backend/policy`, Agent-ID, `status`, `maxSteps`, Zahl der
  Schritte/Entscheidungen, `modelConfigured`, `modelReported`, `inputTokens`,
  `outputTokens`, `decisionMs`, `durationMs`, Zeitstempel und kleine Step-Metadaten
  (Operation/Ziel/valueKey/p/confidence/actionMs/decisionMs). Mittelwert
  `decisionMs/decisions` nur bei `decisions>0`; kein p95 aus einem Einzelrun.
- Die API-Ansicht liefert `costEur` als abgeleiteten Wert; er kann aus einer
  Preistabelle/Fallback-Schätzung stammen. Nicht als Providerrechnung ausgeben.
  Optional nur die exakten eigenen Run-IDs per vorhandener Root-SQL-Metadatenabfrage
  prüfen: `project_id,agent_id,credential_id,provider,provider_cost_usd` aus
  `helena_browser_task_run`; kein `SELECT *`, kein Secret-/Tokenfeld.
- Das Lab-Startformular bzw. `POST .../browser-lab/runs` besitzt **kein `success`**.
  Deshalb keine der obigen Phasen durch einen Lab-Start oder dessen Backend
  `jev-browser` ersetzen. Dieses Runbook prüft den nativen Projektbrowser.
- Providerfehler 401/402/429/5xx: sichere Kategorie/Status protokollieren, Phase
  beenden. 402 ist kein Browsererfolg und keine Erlaubnis zum Schlüsselwechsel,
  Nachladen von Guthaben oder Providerwechsel. Erfolgreiche lokale Observer-
  bzw. Reconnect-Belege bleiben davon getrennt.

Nur synthetische Screenshots und die ausgewählten Metadaten speichern; keine HARs,
Headers, Cookies, Umgebungs-/Settings-Dumps oder rohe Providerexceptions. Nach Ende
die gesicherte **P6BROW26**-Browser-Control-Konfiguration einschließlich Threshold
wiederherstellen und per GET vergleichen. Eigene Preview erst stoppen, wenn die
noch geplante Reconnect-Abnahme fertig ist; Projekt/Dateien behalten oder gemäß
Punkt-6-Runbook reversibel archivieren. Keine User-Tabs/Projekte bereinigen.

Quellanker: `apps/api/src/modules/browser-task/{index,model,runs,lab,connection}.ts`,
`packages/browser-gateway/src/{tools,task/run,task/loop,task/success}.ts`,
`apps/web/src/features/browser-lab/utils/paths.ts` und
`apps/web/src/features/browser-lab/components/LabRunPanel.tsx`.

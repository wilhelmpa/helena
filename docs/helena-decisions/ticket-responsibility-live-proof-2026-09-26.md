# Ticketverantwortung 2b: Root-Abnahme nach R3

Vorbereitet gegen `c2d23311` (`codex/release-ownership`), 2026-09-26. Dieses Dokument ist ein Ablauf, kein Beleg einer bereits erfolgten Live-Abnahme. Nur der Root-Orchestrator führt Liveänderungen aus. Native Routines, ihre Zeiten, Runtime-Policies und Budgets bleiben unverändert.

## Vorhandene Beweise wiederverwenden

- `apps/api/src/modules/issues/__tests__/integration/responsibility.test.ts`: fehlender/null Assignee, Delegation, null-PATCH, Agent als Assignee verweigert, Unteraufgabe übernimmt einen **vom Default-Owner verschiedenen** menschlichen Parent-Assignee, Aufgabenliste/ACL, Mitgliedschaftsentzug und Race. Diese Tests erneut im privaten Release-Gate ausführen, keine zweite Testsuite kopieren.
- `apps/api/src/mcp/__tests__/integration/structured-results.test.ts`: echtes MCP SDK, `InMemoryTransport`, `buildMcpServer`, `create_issue` ohne Assignee → menschlicher Owner.
- Root-Proofstil `/tmp/helena-approval-live-proof.ts`: vorhandene Runtime-Umgebung erben; Module intern importieren; ausschließlich ausgewählte IDs/Booleans ausgeben; Fehler nur mit Phase und Fehlertyp melden.
- `tools/hapi.sh` ist historisch und laut Root derzeit kein verlässlicher Abnahmeweg. `isolation/proof/plan-api.sh` ist ein **privater** Test-API-Launcher; weder seine Seed-Datei noch `bun test` mit der Live-DB starten.

## Reihenfolge und Stop-Bedingungen

1. R3 ist live akzeptiert. Ownership-Kandidat im gemeinsamen Gate prüfen, In-flight-Check und Deployment nach Root-Prozess. Live HEAD und deployed marker müssen übereinstimmen; Commit `c2d23311` muss Vorfahr sein.
2. `ownership-backfill-proof.ts` zuerst ohne `--apply` ausführen. Es liest nur das feste Manifest PRIV-12/id63 und PRIV-13/id64, Projekt und verantwortliche Mitgliedschaft in einer **READ ONLY**-Transaktion. Keine Secrets, Sessiontoken oder Accountlisten ausgeben.
3. Das Manifest muss genau `issue.id=63`/`sequence_number=12` und `issue.id=64`/`sequence_number=13`, jeweils `project.key=PRIV`, erfüllen. Apply verlangt zusätzlich die im Dry-run bestätigten `--project-id`, `--team-id` und `--owner-id`. Fehlendes oder umnummeriertes Ziel bedeutet Abbruch; nicht nach Titel suchen und nicht auf ein anderes Ticket ausweichen.
4. Der kanonische `resolveIssueAssignee` muss einen aktiven menschlichen Owner mit Aufgabenleserecht liefern. Bereits gesetzte gültige menschliche Verantwortung wird erhalten, auch wenn sie vom Default-Owner abweicht. Ein ungültiger gesetzter Assignee wird ausdrücklich nicht still repariert.
5. Backfill genau einmal anwenden, danach ein zweites Mal anwenden: erstes Ergebnis `changed=2` (oder weniger, falls bereits korrekt zugewiesen), zweites `changed=0`. Status, Archivierung und Delegat bleiben identisch; `completed`/`canceled` sind ausdrücklich keine Ausnahme von menschlicher Verantwortung. Auditkommentar und Zuweisung liegen in derselben Transaktion; beim zweiten Lauf entsteht kein weiterer Kommentar.
6. API/MCP-Fälle mit eindeutig synthetischen Fixtures durchführen, danach Cleanup und echte Owner-UI-Abnahme. Nicht als bestanden melden, solange die Ergebnisse nur aus dem privaten Gate stammen.

## Ausführbarer, idempotenter Backfill

Datei: `apps/api/src/scripts/ownership-backfill-proof.ts`. Standard ist Dry-run. Die Änderung ist auf **die zwei manifestierten NULL-Assignees** beschränkt. Projekt- und Ticket-Zeilensperre schützen vor einem gleichzeitigen normalen API-Update; die UPDATE-Bedingung prüft ID, Projekt, Nummer und NULL nochmals. Keine zusätzlichen Webhooks oder Nachrichten werden beim historischen Backfill ausgelöst.

Root verwendet den vorhandenen `EnvironmentFile=/etc/volition/plan.env`, ohne ihn zu lesen oder auszugeben. Beispiel auf Kingston, erst nach geprüftem Deployment:

```sh
sudo systemd-run --wait --pipe --collect \
  --unit=helena-ownership-2b-dry \
  --property=User=volition-plan --property=Group=volition \
  --property=WorkingDirectory=/srv/volition/source/plan \
  --property=EnvironmentFile=/etc/volition/plan.env \
  --property=NoNewPrivileges=yes --property=PrivateTmp=yes \
  /usr/local/bin/bun run apps/api/src/scripts/ownership-backfill-proof.ts --dry-run
```

Den **vollständigen geprüften Live-Commit** für `VERIFIED_LIVE_HEAD` sowie Projekt-/Team-ID und `responsibleUserId` aus dem geprüften Dry-run einsetzen; nicht blind `HEAD` unmittelbar vor dem Schreibaufruf einsetzen. Dieselbe Unit mit anderem Namen und Argumenten starten:

```sh
sudo systemd-run --wait --pipe --collect \
  --unit=helena-ownership-2b-apply \
  --property=User=volition-plan --property=Group=volition \
  --property=WorkingDirectory=/srv/volition/source/plan \
  --property=EnvironmentFile=/etc/volition/plan.env \
  --property=NoNewPrivileges=yes --property=PrivateTmp=yes \
  /usr/local/bin/bun run apps/api/src/scripts/ownership-backfill-proof.ts \
  --apply --expected-head=VERIFIED_LIVE_HEAD \
  --project-id=REVIEWED_PROJECT_ID --team-id=REVIEWED_TEAM_ID --owner-id=REVIEWED_OWNER_ID
```

Diesen Apply-Aufruf zweimal ausführen. Der erwartete Hash verhindert ein versehentliches Anwenden nach einem zwischenzeitlichen Releasewechsel. Er ersetzt nicht den Vergleich mit dem deployed marker. Ausgabe enthält nur Modus, Zielkennung, ID, HEAD und Ergebnisbooleans/Zähler. Bei Exit≠0 Phase/Fehlertyp untersuchen; keine komplette Exception, SQL-Parameter oder Environment dumpen.

Git verweigert im Servicekontext standardmäßig das vom Deploy-Benutzer besessene Repository. Das Skript setzt deshalb für seine beiden **lesenden** Git-Aufrufe ausschließlich `-c safe.directory=/srv/volition/source/plan` und verlangt genau dieses Arbeitsverzeichnis. Diese Variante wurde als `volition-plan` read-only geprüft; keine globale Git-Konfiguration geändert.

## Lokaler API/MCP-Proof mit echten Routen

Kein neuer Netzwerklistener, Schlüssel oder Login ist erforderlich. Root darf eine separate Prozessinstanz der geprüften Module als `volition-plan` verwenden. Dieser Proof prüft Routenvalidierung, fachliche Guards und MCP-Dispatch; **er ist kein Nachweis der HTTP-Authentifizierung**. Die echte Owner-Session wird abschließend separat im IAB geprüft.

Der geprüfte Elysia-Mechanismus für einen lokalen Testkontext ist ein zuerst registriertes Plugin mit demselben Namen `auth-context`; Elysia dedupliziert dann das importierte Auth-Plugin. Der echte Webserver wird weder verändert noch neu gestartet. Das darf nur in dem temporären, nicht lauschenden Root-Proofprozess passieren:

```ts
const app = new Elysia()
  .use(new Elysia({ name: 'auth-context' }).resolve({ as: 'scoped' }, () => ({ user: actor })))
  .use(issueRoutes);
// actor ist ein explizit ausgewählter DB-Fixture-User; niemals per Requestheader auswählbar.
// Kein app.listen(), keine Änderung an authContext, app.ts oder Produktionsmodulen.
const response = await app.handle(new Request('http://localhost/projects/PROOFKEY/issues', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ columnId, title: marker + ': API omitted' }),
}));
```

Root verwendet für die gesamte Abnahme einen zufälligen Marker, z.B. `ownership-2b-<UUID>`, und protokolliert ausschließlich diesen Marker, Fixture-IDs, HTTP-Status und Soll/Ist-Booleans. Keine vollständigen echten Ticket-, Benutzer- oder Mitgliederdaten ausgeben.

### Fixtures vor den Fällen

Die synthetischen Fälle gehören in einen **frischen, direkt per DB angelegten Fixture-Team-/Projektbereich**, nicht in PRIV, FAM oder ein produktives Projekt. Direkte Anlage vermeidet Provisionierungsjobs, Starter-Bundles und Agent-Run-Trigger. Benötigt werden:

- Ein Team und Projekt mit Marker, projektlokalem `mcp_enabled=true`, `autopilot_level=3`, einer `unstarted`-Spalte ohne Auto-Assignee und einer `completed`-Spalte. Kein Provider, Webhook, Workflow, Zeitplan, Provisionierungsjob oder Notification-Preference-Eintrag.
- Zwei lokale synthetische menschliche `user`-Rows (H0 Team-/Projektowner, H1 Projektmitglied) und eine synthetische Bot-User-/`ai_agent`-Row A. Diese sind reine Datenfixtures ohne `account`, `session`, `apikey` oder Loginmöglichkeit; E-Mails unter `.invalid`. H1 sorgt dafür, dass Parent-Vererbung tatsächlich vom Owner-Fallback unterscheidbar ist.
- A gehört zum Fixture-Team/-Projekt, `kind=external`, `trigger_on_assign=false`, `trigger_on_mention=false`, `paused_at=now()`. Kein Runner, kein Runtime-Profil, keine Credentials. Human-Assignee-Prüfung darf A nicht durchlassen. Keine Rollen oder Einstellungen eines echten Agenten ändern.
- Alle drei `project_member`-Rows gehören nur zum Fixtureprojekt. H0 ist Owner; H1 und A erhalten eine projektbezogene Rolle mit `work_items` read/create/edit. Beim MCP-Aufruf bleibt die Projektgrenze aktiv. Kein God-Bypass für H1/A.
- H0/H1 haben keine Notification-Preferences; `notification-preferences/service.ts` wählt dann für Email/Telegram ausschließlich `false`. Vor Start explizit prüfen. Die synthetischen Benutzer haben keine Telegram-Verbindung; der neue Teambereich hat keine Providerkonfiguration. Ein unerwarteter `notification_delivery`- oder `agent_run`-Eintrag des Fixtureprojekts ist ein Abnahmefehler, nicht etwas zum Wegignorieren.

Für MCP den bestehenden SDK-Aufbau aus `structured-results.test.ts` übernehmen: `Client` ↔ `InMemoryTransport.createLinkedPair()` ↔ `buildMcpServer(app, credential, actor.id)`. Den **nicht authentifizierenden lokalen Harness-Marker**, keinen echten Key, als `credential` verwenden. Die echte Route läuft durch `dispatchTool`/`app.handle`; native Route-Schemas und die Projekt-MCP-Guards bleiben unverändert. Nur die benötigten nativen Route-Tools registrieren, mit ihrer tatsächlichen `routeTools(app)`-Metadatenstruktur; keine permissiven Ersatzhandler. Die produktive MCP-Mount-Authentifizierung wird damit bewusst nicht umgangen oder als getestet behauptet.

### Konkrete Fallmatrix

Alle Antworten zusätzlich durch `GET /issues/<id>` und die DB bestätigen. Der Inhalt eines MCP-Resultats kommt aus `CallToolResultSchema`/`structuredContent`; ein HTTP 200 allein bedeutet keinen erfolgreichen MCP-Toolaufruf.

| Fall | Actor und echter Aufruf | Erwartung |
| --- | --- | --- |
| API Default | H0: `POST /projects/<key>/issues {columnId,title}` | 201; `assigneeUserId=H0`, kein Delegat |
| API null | H0: gleicher POST mit `assigneeUserId:null` | 201; H0 |
| MCP Default | H0: `create_issue {projectKey,columnId,title}` | `isError=false`, `structuredContent.ok=true`, Status 201, H0 |
| MCP null | H0: `create_issue` mit `assigneeUserId:null` | gleicher erfolgreicher Owner-Fallback |
| Delegat | H0: POST mit `delegateUserId=A` | H0 bleibt verantwortlich, A ausschließlich Delegat; kein Agent-Run |
| null-PATCH | H0: `PATCH /issues/<delegatedId> {assigneeUserId:null}` | 200; H0 und A unverändert erhalten |
| Agent als Mensch verboten | H0: POST und PATCH mit `assigneeUserId=A` | jeweils 400; fehlgeschlagener POST erzeugt kein Ticket, PATCH verändert den bisherigen Assignee nicht |
| Parent mit H1 | H0: POST mit `assigneeUserId:H1` | 201; explizit H1, nicht H0 |
| Agent-Subtask API | A: POST mit `parentId`, ohne Assignee, `delegateUserId:A` | 201; H1 geerbt, Parent-ID korrekt, A Delegat |
| Agent-Subtask MCP | A: `create_issue` mit denselben Angaben | erfolgreicher MCP-Dispatch; H1 geerbt, A Delegat |
| Subtask null-PATCH | H0: PATCH auf beide Subtasks mit `assigneeUserId:null` | H1 bleibt durch Parent-Vererbung verantwortlich |
| Aufgabenübersicht | H0: `GET /issues?assignee=me&stateType=open`; H1 analog | jeweils eigene offene Fixture-IDs enthalten; delegierte Aufgabe mit H0 als Assignee und A als Delegate |
| Negative ACL | H1 auf PRIV-12 nur per GET; mutierender Negativtest nur gegen fremdes Fixtureticket | 403; echtes PRIV-12 nachher unverändert |

Für die ACL-Prüfung keinen mutierenden Body gegen das echte Ticket senden: zuerst GET=403; die PATCH-Verweigerung wird im bestehenden privaten Responsibility-Test nachgewiesen. Live nur synthetische Fremdprojekt-Tickets für einen mutierenden Negativtest verwenden.

### Cleanup ohne produktive Daten anzufassen

Fixture-IDs vor jedem ersten Schreibaufruf in einem Root-eigenen Manifest sichern; bei Abbruch bleiben sie dort zur gezielten Nacharbeit. Vor Cleanup alle synthetischen Tickets archivieren (Kinder zuerst) und jede archivierte ID prüfen. Die API kann über `POST /issues/<id>/archive` verwendet werden; fehlgeschlagene Tests dürfen ihre Fixture-IDs nicht verlieren.

Für endgültige Bereinigung entscheidet Root anhand des Manifests: nur Zeilen des exakten Fixtureprojekt-/Team-IDs und Marker entfernen, niemals nach breitem Titelpräfix. Vorher sicherstellen, dass keine Nicht-Fixture-Tickets, Memberships, Provider, Runs oder Delivery-Einträge hinzugekommen sind. Abhängige Issue-Aktivitäten/Watcher/Statusverläufe dürfen nur über die FK-Cascades der **exakt manifestierten Fixtureobjekte** verschwinden. Projekt → synthetischer Agent → Fixture-Team → synthetische User; keine echten User löschen. Alternativ Fixtures archiviert für eine sichtbare UI-Abnahme behalten und den offenen Cleanup ausdrücklich notieren. Keine Vault-/Workspace-Dateien entstehen, da die Provisionierung nicht gestartet wurde.

PRIV-12/PRIV-13 und deren neue Backfill-Auditkommentare gehören niemals zum Cleanup. Ein erfolgreicher Backfill wird nicht wieder auf NULL gesetzt.

## Echte Owner-UI-Abnahme und Abschlussbeleg

In einem eigenen IAB-Testtab mit vorhandener Owner-Session:

1. PRIV-12 und PRIV-13 über Detailseiten oder `/tasks?state=any` öffnen: verantwortlicher Mensch ist sichtbar, vorhandener Delegat separat. PRIV-12 war bei Root-Read-only-Prüfung `completed`, PRIV-13 `canceled`; der Backfill verändert diese Zustände nicht.
2. Root hat geklärt: derzeit genau **VOL-14** nicht archiviert und offen; PRIV-4 ist archiviert. `/tasks` ohne Query zeigt bereits alle offenen zugänglichen Tickets ohne Assignee-/Projektfilter. Home „Meine Aufgaben“ setzt dagegen `assignee=me`, und sein „Alle“-Link behält diesen Filter (`/tasks?assignee=me`). Beide zeigen derzeit korrekt ein Ticket. Kein neuer Filter und keine Statusreparatur nötig. Beim späteren Vergleich aktuelle Counts neu lesen, keine veraltete Behauptung „drei offene Tickets“ übernehmen.
3. Eine synthetische delegierte Aufgabe mit dem **echten Owner als Assignee** ist nur für diesen UI-Schritt erforderlich. Sie separat im Fixtureprojekt anlegen, Owner-Mitgliedschaft ausschließlich dort; Notification-Preferences fehlen, Agent bleibt pausiert. Prüfen, dass die Aufgabe in der Owner-Liste erscheint und der Agent nur als Badge/Delegat dargestellt wird. Danach archivieren und die temporäre Membership entfernen.
4. „Warten auf dich“ ist nicht pauschal gleich „alle offenen Aufgaben“: nur bei passender Warte-/Eingabephase Sichtbarkeit verlangen, sonst die allgemeine Aufgabenliste als Vollständigkeitsbeweis verwenden.

Abschlussbericht: verifizierter Live-Hash; Backfill zweimal (Zähler); Anzahl API-/MCP-Fälle bestanden/fehlgeschlagen; H0≠H1-Vererbungsbeleg; keine Runs/externen Zustellungen; UI-Beleg; Cleanupstatus. HTTP-Auth und native Policy nur als bestanden ausweisen, wenn sie separat über die echte Oberfläche geprüft wurden. Ohne diese Ausführung bleibt 2b „vorbereitet“, nicht „live abgeschlossen“.

## Bereits durchgeführte Vorbereitungskontrollen

Der Backfill wurde ausschließlich auf privatem PostgreSQL `127.0.0.1:55566`, Datenbank `itsaplan_test`, mit synthetischen Rows ausgeführt. Acht Szenarien bestanden: Dry-run schreibt nichts; falsche Team-ID sowie falsche Owner-ID verweigert; beide NULL-Assignees gesetzt; zweiter Apply ohne Änderung und ohne doppelten Auditkommentar; completed/canceled, Archivzeit und Delegat erhalten; falsche Nummer beim zweiten Manifestziel rollt auch die erste Zuweisung samt Audit zurück; bereits gültig an einen anderen Menschen vergebene Aufgabe bleibt bei diesem Menschen. Kein Live-Dry-run oder Live-Apply durch den Subagenten.

Für diese private Prüfung akzeptiert das Skript nur `NODE_ENV=test` mit lokalem Host, explizitem Nicht-5432-Port und Datenbanknamen mit Suffix `_test`; der synthetische erwartete HEAD ist dann 40×`0`. Außerhalb dieser engen Testkombination verlangt es den Systembenutzer `volition-plan`, einen echten Git-HEAD und die Kandidaten-Abstammung. Gezielter TypeScript-Check einschließlich Importabhängigkeiten, ESLint und Prettier des Skripts bestanden. Der isolierte Elysia-Test bestätigte lediglich die Plugin-Deduplizierung; die vollständige Live-API/MCP-Matrix oben wurde noch nicht ausgeführt.

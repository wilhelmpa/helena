# Punkt 6: Root-Abnahme mit eigenem Projekt

Geprüfte Produktbasis: `93f9762c`; Root-Folgestand `0d0cdfa3` ändert hier nur Tests
und Dokumentation. **Vorbereitet, nicht live ausgeführt.** Erst nach Root-Gate und
Deployment anwenden. Projekt anschließend für die Browserabnahme `c8668b92` behalten.

## 1. Eigene Fixture über den echten Blueprint-Weg anlegen

Die beiliegende `blueprint/` erzeugt `P6BROW26` / `p6brow26`, dessen Koordinator,
eine Kopie der vorhandenen Vorlage `coder`, einen Bereich, eine synthetische Notiz
und ein leeres Notizboard. Keine Routinen, Connectoren oder Provideraufrufe.
Der Pool aus Punkt 5 muss bereits vorhanden sein. Zuerst über Helena prüfen, dass
der Schlüssel **noch nicht existiert**; bei Kollision die Fixture auf einen neuen
eigenen Schlüssel ändern, niemals ein vorhandenes Projekt übernehmen.

Blueprints haben in diesem Stand einen Operator-CLI, **keinen UI-Importdialog**.
Der CLI verwendet dieselben Projektdienste wie „Neues Projekt“ und `POST /projects`.
Für diesen Regressionstest das Projekt noch nicht vorher in der UI anlegen: Der
erste Durchlauf soll die neue Provisionierung vor dem Wissensschreiben abwarten.

Root stellt nur die geprüften Blueprint-Datendateien aus dem Commit unter einem
neuen, für `volition-plan` lesbaren `/opt/helena-proof/p6/<sha>/blueprint` bereit.
Ausführung des installierten CLI als **API-Benutzer**, nicht als root; systemd liest
die bestehende EnvironmentFile intern, ohne Ausgabe oder Kopie ihrer Inhalte:

```sh
sudo systemd-run --wait --pipe --collect --uid=volition-plan --gid=volition \
  -p UMask=0007 -p EnvironmentFile=/etc/volition/plan.env \
  -p WorkingDirectory=/srv/volition/source/plan/apps/api \
  --setenv=PROJECT_VAULT_ROOT=/srv/volition/vault \
  --setenv=PROJECT_WORKSPACE_ROOT=/srv/volition/workspaces/projects \
  /usr/local/bin/bun src/scripts/project-blueprint.ts \
  --blueprint /opt/helena-proof/p6/<sha>/blueprint \
  --sections=project,areas,agents,knowledge,report --dry-run
```

Plan auf ausschließlich `P6BROW26`, dessen Agenten und Wissensdateien prüfen; keine
Blocker überspringen. Danach denselben Befehl mit `--apply` statt `--dry-run`.
CLI-Exitcode allein genügt nicht: Plan-Blocker können eine Teilanwendung erlauben.
Den Prozess bei längerer Laufzeit als Tool-Session weiterverfolgen, mit Updates
spätestens nach 60 Sekunden; kein wiederholtes Apply parallel zur ersten Anwendung.

Erwartung: aktuelle Provisionierung `pending → succeeded`, anschließend Notiz und
Board vorhanden. `[WAIT]` wird nur ausgegeben, wenn der Worker noch nicht fertig
war; sein Fehlen beweist keinen Fehler. Die Barriere wartet maximal 300 Sekunden
und darf bei Fehler/Timeout keine API-eigene Projektwurzel erzeugen.

UI: Projekt → Einstellungen → Allgemein → Einrichtung. Authentifizierte API-Wege
ohne neue Login-/Tokenbeschaffung: `GET /projects/P6BROW26/setup` (kleiner Status)
und `GET /projects/P6BROW26/provisioning` (Job). Die Routen stehen relativ zum
vorhandenen API-Basispfad. Bei `failed` erst Ursache feststellen, dann genau dieses
Projekt über UI „Wiederholen“ / `POST /projects/P6BROW26/provisioning/retry` erneut
anstoßen; bei `pending` ist Retry nicht zulässig. Anschließend denselben Blueprint
erneut anwenden, keine Verzeichnisse mit manuellem `chown` reparieren.

## 2. Ownership, Descriptoren und automatische Runner-Aufnahme

Root bestätigt die konfigurierten Pfade/Benutzernamen anhand ausgewählter **nicht
geheimer** Metadaten. Die folgenden Werte sind die geprüften Standardwerte:

| Gegenstand | Erwartung |
| --- | --- |
| `/srv/volition/workspaces/projects/p6brow26` | echtes Verzeichnis, Eigentümer `vp-p6brow26`; eigene UID |
| `/srv/volition/vault/Projects/P6BROW26` | echte Wurzel, Eigentümer `root` oder `volition-hermes`, **nicht `volition-plan`**; Gruppe `volition`; Projekt-UID mit effektivem/default ACL `rwx` |
| Notiz `Docs/Provisioning-Proof.md` | synthetischer Marker sichtbar in Helena; API-Dateibesitzer darf von Wurzel abweichen |
| Profile `…/hermes/profiles/p6brow26` und `p6brow26_<agentId>` | nur `stat`, echte Verzeichnisse, Projekt-UID, `0700`; keine Inhalte lesen |
| Descriptoren `…/hermes/run/agents/p6brow26.json` und `p6brow26_<agentId>.json` | echte reguläre Dateien, `0600`, Runner-Besitzer; nur `stat` und SHA-256 |

Agent-ID aus der eigenen Projektagentenliste übernehmen; Descriptor-Dateien
enthalten API-Keys: **kein `cat`, `jq`, Inhaltssnapshot oder Kopieren**. Beispiele:

```sh
stat -c '%U %G %a %F %n' /srv/volition/vault/Projects/P6BROW26
getfacl -cp /srv/volition/vault/Projects/P6BROW26
stat -c '%U %G %a %F %n' /var/lib/volition/hermes/run/agents/p6brow26.json
sha256sum /var/lib/volition/hermes/run/agents/p6brow26.json
systemctl show volition-hermes-runner.service -p ActiveState -p MainPID
```

Vorher/Nachher-Runner-PID und Descriptor-Hashes notieren. Der Provisioner fordert
bei Änderungen eine geordnete Neuaufnahme an; **kein manuelles SIGTERM/Restart**.
Bei aktiven Runs wartet der Runner auf deren Ende. In der vereinbarten ruhigen
Abnahmephase innerhalb 90 Sekunden die beiden eigenen Agenten in Helena prüfen:
existieren, richtiges Projekt, `lastSeenAt` frisch, `runtimeState.adapter/status`
plausibel. Offline/degraded separat melden; `succeeded` allein beweist keine
Runner-Aufnahme. Kein Chat/Modellaufruf ist für diesen Statuscheck nötig.

Nach Erfolg nochmals Dry-run (keine Änderungen) und einmal Apply zur Idempotenz:
keine neue Agentenkopie, Notiz unverändert, Descriptor-Hashes und Runner-PID stabil.
Kein manueller Gesamt-Refresh aller Projekte.

## 3. Eigene Workspace- und Browsergrenzen

Optionalen zweiten eigenen Peer `P6PEER26` über **Neues Projekt** im gleichen Team
erstellen, nicht aus einem Nutzerprojekt kopieren. Gleicher API-Weg wäre
`POST /projects` mit `{"key":"P6PEER26","name":"Abnahme Isolation Peer","locale":"de"}`.
`provisionResources` weglassen: die normalen Defaults enthalten auch Terminal,
Workspace, Dateien, Koordinator und Browser. Einrichtung auch hier abwarten.

In den beiden normalen Helena-Projektterminals jeweils eine eigene harmlose
Markerdatei erzeugen. Im Terminal A prüfen: eigene UID `vp-p6brow26`, eigener
Arbeitsbereich/Marker lesbar; B-Marker am bekannten B-Workspacepfad unsichtbar.
In B umgekehrt prüfen. Root bestätigt vorher, dass beide Marker tatsächlich
existieren. Keine fremden Nutzerdateien für negative Lesetests verwenden.

Browser beider eigener Projekte öffnen. Root prüft getrennte aktive Units
`volition-project-browser-chromium@p6brow26.service` / `@p6peer26.service` und
entsprechende Kasm-Units mit `systemctl show -p ActiveState -p MainPID` sowie nur
`stat` der jeweiligen Browser-State-Verzeichnisse. Profile bleiben unangetastet.
Der Browserdienst benutzt bewusst `volition-browser`; entscheidend sind getrennte
Projektprofile/Prozesse und die Projektrouten, nicht verschiedene Browser-UIDs.
Ein eigener Tab in A darf nicht in Bs Tab-Liste erscheinen. Nur selbst angelegte
Tabs verwenden. Reconnect/Idle werden erst mit der späteren Fixture abgenommen.

## 4. Downloadfreie Preview-Vorbereitung

Neues Provisionieren installiert **keine** Web-Abhängigkeiten. Der Preview-Launcher
verlangt ein eigenes `package.json`, `scripts.dev` mit `astro dev`, `vite` oder
`next dev`, die entsprechende deklarierte Dependency und ein tatsächlich
vorhandenes `node_modules/.bin/<runtime>`. Python-/Shell-Server sind kein Ersatz.

Vorhandene **eigene** Preview-Proof-Daten mit vollständigen Dependencies bevorzugt
als unabhängige Kopie unter `p6brow26/browser-proof` übernehmen. Alternativ nur die
bereits installierten öffentlichen Runtime-Pakete einschließlich ihrer aufgelösten
Dependency-Closure materialisieren; Next ist in Helenas Lockfile vorhanden.
Keine Nutzerquellen, `.env`, Profile oder Caches kopieren; keine Hardlinks, kein
`npm/bun install`, `npx` oder Fetch. Alle Symlinks müssen innerhalb des neuen eigenen
Workspace auflösbar sein. Ein Link auf die Live-Installation unter
`/srv/volition/source/plan` scheitert am Sandbox-Mount und ist keine Vorbereitung.
Keine globale Freigabe/Bind-Mount-Änderung dafür vornehmen. Unvollständige lokale
Dependencies ausdrücklich als Preview-Setupblocker belassen.

Für Next: eigene minimale JavaScript-`app/layout.js` und `app/page.js`, passendes
`package.json` mit den tatsächlich vorhandenen Next/React-Versionen und
`"dev":"next dev --webpack"`; Browser-Fixture aus `c8668b92` nach
`public/fixture.html`. Keine TypeScript-Dateien verwenden, die eine automatische
Installation fehlender Typen auslösen könnten. Vor späterem Start sicherstellen,
dass das passende vorhandene SWC-Binary mitkopiert wurde; sonst nicht starten.
Astro/Vite nur verwenden, wenn deren installierte Closure tatsächlich vorhanden ist.

Später normal über Preview-UI oder `preview_start` starten:
`{"name":"browser-proof","cwd":"browser-proof","idleTimeoutSec":900}`.
Die zurückgegebene eigene URL nutzen, `allowLocalAddresses` aus lassen und den
alten Fixturetab für den separaten Browser-Reconnect-Beweis erhalten.

## 5. Ergebnis und reversible Stilllegung

Notieren: installierter Commit, eigene Projekt-/Job-/Agent-IDs, aktueller Jobstatus,
Ownership/ACL, Descriptor-Hashes vorher/nachher, Agentenheartbeat, eigener/Peer-
Namespace-Test und Browser-Unit-PIDs. Alle Prüfungen starten als **NOT RUN**.
Providerfähigkeit und späterer JEV-Erfolg sind separate Abnahmen.

Nach Punkt 6 Projekt behalten. Nach Browserabnahme nur eigene Preview per
`preview_stop` beenden und `preview_status` prüfen, eigene Agenten über Pause
stilllegen, Projekt eindeutig „Abnahme abgeschlossen – aufbewahren“ benennen.
Es gibt hier **keinen Projekt-Archiv-Endpunkt**; `DELETE /projects/:key` löscht
DB-Daten irreversibel und ist kein Cleanup-Schritt dieses Runbooks. Eigene
Fixture-/Beweisartefakte bei Bedarf in den dokumentierten Backupbereich verschieben;
provisionierte Workspace-/Vault-Wurzeln dabei bestehen lassen. Keine Nutzer-Tabs
schließen, keine Services anderer Projekte stoppen, keine globalen ACLs ändern.

Codegrundlage: `project-blueprints/{apply,provisioning,plan}.ts`,
`scripts/project-blueprint.ts`, `projects/{service,index,model}.ts`,
`integration/{provisioner,plan-coordinator}.mjs`, `isolation/{launcher,helena_previews}.py`
und `NewProjectModal.tsx`/`SettingsSetup.tsx`. Nur Fixture/Runbook, keine Produktänderung.

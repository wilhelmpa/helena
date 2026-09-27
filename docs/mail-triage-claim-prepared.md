# Punkt 4B: vorbereiteter Projektclaim (nicht integriert/live)

Basis: 63734354a569431ec11b5c2209b5648e3d1b93b1. Isolierter Branch
`codex/fix-mail-triage-claim`. Kein Teil des Mailparser-Releases.

`runProjectTriage` erwirbt vor Receipt-Retries und Klassifikationen einen dauerhaften
Projektclaim mit zufälligem Token. Die bisherige ausschließlich für den Batchlock
gehaltene Transaktion entfällt; Einzelmails behalten ihre eigenen Commits. Andere
Prozesse erhalten 409, kein TTL übernimmt einen Claim. Requestabbruch wird zwischen
Mails/Receipt-Retries geprüft; der aktuelle Intake endet einschließlich Indexarbeit.

Der explizite DB-Lifetimescope drainiert ORM-Transaktionen einschließlich Poolwartezeit,
Callback und Commit/Rollback. postgres-js kann sein Transaktionspromise beim Socketende
vor dem Callback ablehnen. Innerhalb des Scopes wartet deshalb auch der Aufrufer auf den
Callback, damit per-mail catch/finally und der Receipt-Retry-busy-Guard nicht vorauslaufen.
Autocommit-/Transaktionsquerys werden am ursprünglichen postgres-js-Promise beobachtet,
ohne die lazy Query vor `.values()` zu starten. Ein Transportfehler oder unklarer
Driverfehler hält den Claim auch dann, wenn Fachcode den Fehler abgefangen hat.
Bestätigte normale PostgreSQL-Fehler wie Unique-Verletzungen tun das nicht. Außerhalb
des expliziten Scopes bleiben Transaktionscallback, Optionen, Query und Rückgabepromise
unverändert. Keine globale Methodenmutation, kein allgemeiner Lease-/Jobmechanismus.

Unklare Acquire-Antwort: keine Arbeit starten; ein eventuell gespeicherter Claim bleibt.
Unklarer Release: keine automatische Wiederholung. Arbeit ist bereits beendet; der
Claim kann je nach bestätigtem Serverzustand bestehen oder gelöscht sein. Crash oder
Transportunsicherheit erfordern Root-Recovery. Ein noch lebender API-Prozess wird auch
bei beendetem JavaScriptlauf absichtlich nicht automatisch freigegeben.

## Begrenzte native Root-Recovery

Nur native Linux-Prozesse mit `/proc`-Identität sind unterstützt. Vor dem ersten Claim
werden machine-id, boot-id, PID, Startticks, PID-Namespace und UID erfasst. Die
prozessweit eindeutige `application_name` bindet zu seinen PostgreSQL-Sessions.
Ein Mac/fehlende lesbare Identität verweigert den Batch **vor** Claim-Erwerb.

`deployment/volition-stack/native/mail-triage-claim-recover.py` hat genau zwei Schritte:

1. `inspect PROJECT_ID /root/<privates-0700-Verzeichnis>/claim.json` verweigert einen
   noch lebenden exakten Prozess sowie verbliebene Sessions dieser Runtime. Erlaubte
   Ende-Nachweise: vorheriger Boot desselben Hosts, fehlende PID im selben Namespace
   oder anderer Prozessstart unter wiederverwendeter PID. Snapshot wird exklusiv mit Modus 0600 geschrieben.
2. `release SNAPSHOT EXAKTE_SHA256 /root/<privates-0700-Verzeichnis>/intent.json`
   prüft Prozess-/Sessionende erneut, vergleicht vollständige aktuelle Claimzeile,
   schreibt vorher durable Intent-Evidenz und löscht ausschließlich mit Token +
   vollständigem JSONB-Zeilenvergleich. Ergebnisdatei ist separat exklusiv mit Modus 0600.

Kein Prozessstop, keine TTL, kein erzwungenes Claimstehlen. Ein Fehler nach Intent/Commit
wird als ungeklärtes Ergebnis zurückgegeben; vorhandene Evidenz behalten und den
aktuellen Claim neu prüfen. Eine laufende Runtime muss Root zunächst durch den üblichen
betroffenen-Service-/In-flight-Prozess beenden; das Skript tut dies nie selbst.

## Integration und Abnahmegrenzen

Migration **0190** ist nach Root-Entscheidung die nächste Live-Migration. Ihr
`when=1790430258722` ist exakt `0189.when+1` und liegt vor Paper (`1790436986100`).
Der Snapshot-Vorgänger bleibt exakt 0189 (`8031603c-c110-4e14-9215-1d574809c82c`).
Claim-SQL und Snapshotinhalt sind gegenüber der Belegbasis `0bb698cc` bytegleich;
nur ihre Dateinamen und der neue Journalentry wurden korrigiert. Alle früheren
Journalentries bleiben identisch. Ausschließlich die Claimtabelle mit Projekt-PK/FK
kommt hinzu; keine Bestandsdatenänderung und keine fremden Featurecommits.

Die frühere 0194-Reservierung darf nicht integriert werden: Ihr höherer `when`-Wert
würde vorbereitete Migrationen überspringen. Für die spätere tatsächliche Deployfolge
ist separat vorgesehen: Paper 0190→0191, Vault 0191→0192, ChatJEV 0192→0193,
BrowserJEV 0193→0194. Deren bisherige `when`-Werte bleiben erhalten; ihre kumulativen
Snapshots müssen bei Integration die Claimtabelle mitführen und korrekte Vorgänger
bekommen. Diese fremden Zweige sind in diesem Korrekturcommit nicht geändert.
Migration und Rootfullgate erfolgen erst im separaten B-Release.

Produktionsüberschneidungen: `mail-triage/classify.ts` und `index.ts`, DBclient/Exports,
DBschema/app und Migrationsjournal. Keine Webdatei geändert; bestehende 409-Antwort
benennt laufenden Claim/Root-Recovery. Keine
Recovery-UI. `classifyPending` war bisher nicht durch den Projektbatchlock geschützt
und bleibt außerhalb dieses begrenzten Auftrags; kein globaler Exclusion-Nachweis.

Lokale Checks: API- und DB-Typecheck, scoped ESLint, 9 echte postgres-js-Query-/Callbacktests
(26 Assertions), 4 reine Recoverytests; Format und diffcheck grün.
Altrot-Probe ohne Querybeobachtung: genau die beiden Transport-/Shutdown-catch-
Regressionen schlagen fehl; Quelle wiederhergestellt, erneut 9/0.

Der eigene Linux/PostgreSQL-17-Lauf auf Port 65527 bestand am 27.09.2026 um 06:54:45:
**10 Integrationstests/122 Assertions**, zusätzlich die 9 DB-Lifecycletests/26 Assertions.
Belegt: 10 native Projektläufe mit Receipt-Retry/Intake/Index/Matching ohne Provider,
10 gleichzeitige Claims ohne Poolbindung, Replica-Exclusion, Abort mitten im echten
SQL-blockierten Intake, später Callback nach Backendverlust, offener Commit nach
Callbackende, verlorene Acquire-Antwort (keine Arbeit), fehlgeschlagene Freigabe,
Clientverlust während weiterhin blockiertem Backendwrite trotz Fachcode-catch sowie
SIGKILL/Prozessende/DB-Sessionende und Token-/Fullrow-CAS. Kein Mail-/Receiptbestand
außer synthetischen privaten Testdaten. Rohlog: `~/agent-work/mail-triage-claim-pg-65527/run.log`.
PG/Proxy 65527/65528 sind gestoppt, test.1 freigegeben. Keine weiteren Serverläufe.

Testinfrastruktur wurde vor diesem grünen Lauf korrigiert: Lazy-Query-Test löst den
Treiber relativ zu dessen Paket auf; Paketverlustproxy hält den ursprünglichen
Backendport vor URL-Umschreibung fest. Der Test eines absichtlich beendeten Backends
läuft in einem eigenen Kindprozess: postgres-js 3.4.9 kann bei späterem internem Write
auf dem geschlossenen Socket einen ungefangenen Fehler erzeugen. Der Claim bleibt
auch bei diesem Prozessabbruch bestehen. Kein Driverpatch und keine Behauptung,
dass die Änderung jeden datenbankbedingten Prozessabbruch verhindert.

Rootfullgate, unabhängige finale Source-Abnahme und Live-Abnahme bleiben ausstehend.
Keine Provider-/Live-/GPU-Aktion und kein Deployment.

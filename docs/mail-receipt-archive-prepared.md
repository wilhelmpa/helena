# Beleggebundene archivierte Quellmail (vorbereitet)

Basis: b1b4d82bffe2ff232f09325d2d76d2d815357d22. Kein Deployment und keine Migration.

Der normale 30-Tage-Mailcache-Prune bewahrt genau die einzelne Mail, deren Original ein
Beleg referenziert. Ein Attachment-FK ist autoritativ; ohne FK ist nur typgeprüfte
`mailSource`-Provenienz mit passendem Originalhash und Größe zulässig. Team, Projekt,
Account, Thread und Message müssen zusammenpassen. Der Schutz gilt für die Mailzeile,
ihre EML und Attachments; dadurch bleibt der zugehörige Thread bestehen. Andere alte
Nachrichten desselben Threads werden weiterhin gelöscht. Die bestehende Ausnahme für
Ticket-verknüpfte Threads bleibt erhalten. `deletedAt` und Folderlocations werden nicht
verändert. Der explizite Accountreset bleibt eine getrennte Operation ohne neue Ausnahme.

Unmittelbar vor dem Delete wird unter derselben Projekt-Advisory-Lock `748220` wie beim
Receipt-Intake erneut geprüft. Thread-/Message-Sperren halten Projekt und Quellenidentität
stabil. Nach einem Projektwechsel seit der ersten Auswahl wird diese Mail übersprungen.
Nur `DELETE RETURNING`-Zeilen gelangen in die Datei-/Threadbereinigung. Noch von anderen Mailzeilen referenzierte Rawkeys oder Attachmentpfade bleiben erhalten (z. B. ein gemeinsames Logo). Die
Transaktionen laufen sequenziell und ohne verschachtelten globalen DB-Aufruf. Dies ist
kein allgemeiner Pool-/Retentionumbau und keine Wiederherstellung bereits gelöschter Daten.

`GET /projects/:projectKey/receipts/:receiptId/source-mail` nutzt genau denselben
`projectAdmin`-Leseguard wie der vorhandene Receipt-GET, zusätzlich `assertMailAccess`
inklusive Teammitgliedschaft und MCP-Sperre. Er akzeptiert keinen Message-/Threadparameter.
Die einzige gebundene EML wird lokal gelesen (höchstens 25 MiB), gegen Hash/Größe geprüft
und mit dem vorhandenen Parser gelesen; für Attachments muss auch das tatsächliche
MIME-Original SHA/Größe besitzen. Die Antwort enthält nur Klartext, eine ebenfalls in
Klartext umgewandelte HTML-Alternative und minimale Mailkopf-Felder, mit `private, no-store`.
Der Archivdialog bietet keine Mailaktionen oder Navigation in den Thread. Bestehende
Maillisten, getThread, Send-/Trashaktionen und Folder-/Undelete-Mechanik bleiben unverändert.

## Prüfung

Lokal: reine Bindungstests, ReceiptBody-SSR-Test, API-/Worker-/Web-Typprüfung und scoped
ESLint/Prettier (nur vorhandener Mac-Cache). 21 Mail-Tests mit 96 Assertions und 6 Web-Tests grün. API-/Worker-Typprüfung und scoped ESLint grün; Web-Typprüfung ebenfalls grün.

Auf ausdrückliche Rootfreigabe im exklusiven `test.2`-Slot am 27. September 2026,
07:59:12–07:59:18 CEST, auf exakt `e59d66ef252e8be4a52ef140ec6b11e7c223108a`
privat ausgeführt: **18 Tests / 110 Assertions / 0 Fehler**, 4,78 Sekunden für beide
API-Dateien `receipt-source.test.ts` und `receipt-retention.test.ts`. Neuer Cluster auf
Loopback-Port 65512, ausschließlich synthetische Daten, bestehende Cachelinks, leere
Testumgebung und äußerer 420-Sekunden-Timeout. Keine Provider-/Liveaktion.

Geprüft:

- archivierter Body und Attachment behalten Zeilen, Rawbytes, Attachments sowie 0 Locations;
  ein unbelegter Geschwisterbrief wird gelöscht, Wiederholung löscht nichts zusätzlich;
- echte Intake-/Prune-Aufrufe mit kontrolliertem Advisory-Lock-Warten in beiden Reihenfolgen;
  Intake zuerst schützt, Prune zuerst lässt Intake ohne Quelle fehlschlagen;
- Projektwechsel während wartendem Prune wird erneut geprüft;
- falsche JSON-Typen, geänderte Originalbytes, fremde Message-IDs, Projekte, Teams und MCP;
- Archivzugriff bleibt read-only und liefert keine anderen Nachrichten aus dem Thread.

Sourcehashes vor/nach Lauf identisch; privater Cluster gestoppt, Port und `test.2` danach
frei bestätigt. Private synthetische Nachweise bleiben unter
`/home/wilhelmpa/agent-work/receipt-archive-pg-65512-v1/` (`run.log`, `tests.log`,
`tested-source.sha256`). Kein Cleanup an fremden Daten oder Diensten.

Unabhängiger Sourcereview, gemeinsames Root-Fullgate, anschließender Mailcachebetrieb und
Owner-UI-Abnahme stehen vor Livefreigabe noch aus. Keine privaten Originale im Commit.

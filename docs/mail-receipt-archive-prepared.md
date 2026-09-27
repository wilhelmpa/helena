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

Für Root-Gate neu verfasst, bisher **nicht auf PostgreSQL ausgeführt**:

- archivierter Body und Attachment behalten Zeilen, Rawbytes, Attachments sowie 0 Locations;
  ein unbelegter Geschwisterbrief wird gelöscht, Wiederholung löscht nichts zusätzlich;
- echte Intake-/Prune-Aufrufe mit kontrolliertem Advisory-Lock-Warten in beiden Reihenfolgen;
  Intake zuerst schützt, Prune zuerst lässt Intake ohne Quelle fehlschlagen;
- Projektwechsel während wartendem Prune wird erneut geprüft;
- falsche JSON-Typen, geänderte Originalbytes, fremde Message-IDs, Projekte, Teams und MCP;
- Archivzugriff bleibt read-only und liefert keine anderen Nachrichten aus dem Thread.

Echte Race-/DB-Ausführung, anschließender unveränderter Mailcachebetrieb und Owner-UI-
Abnahme sind durch Root vor Livefreigabe erforderlich. Keine privaten Originale im Commit.

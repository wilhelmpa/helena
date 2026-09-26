# Kurze Root-Abnahme: Freigabekarten (3) und Mail-IDs (4)

Geprüfte Produktstände: Karten `6d925f4d`, Mail `67b975ef`. Je Punkt zuerst dessen
serielles Fullgate/Deployment. Der untenstehende Operator liest die tatsächlich
deployten Module beim exakten freigegebenen HEAD. Er legt keine Fixtures, Karten,
Entwürfe oder Runs an, startet keinen Provider und liest keine Mailinhalte oder
Credentialfelder. Er ersetzt keine HTTP-/UI-Abnahme.

## Einmaliges Staging, zwei kleine Leseläufe

Root prüft `apps/api/src/scripts/approval-mail-read-proof.ts`, kopiert genau diese
Datei in sein geschütztes Staging und vergleicht SHA256. Beispiel bei vorhandenem
Root-Staging-Verzeichnis; dessen vorhandene Rechte nicht verändern:

```sh
sudo install -o root -g root -m 0644 REVIEWED_FILE /var/lib/volition/operator-proofs/approval-mail-read-proof.ts
```

Mit dem bereits geprüften Live-HEAD und einer vorhandenen numerischen ID aufrufen.
`cards --id=` erwartet eine Issue-ID, `mail --id=` eine Mail-Thread-ID mit
projektgebundenem `thread:`-Providerkey. IDs nur aus bestehenden, berechtigten
Metadaten bestimmen; kein neues Objekt erzeugen. Derselbe Aufruf mit anderem
Unitnamen und Modus dient Punkt 4:

```sh
sudo systemd-run --wait --pipe --collect \
  --unit=helena-cards-read-proof \
  --property=User=volition-plan --property=Group=volition \
  --property=WorkingDirectory=/srv/volition/source/plan \
  --property=EnvironmentFile=/etc/volition/plan.env \
  --property=NoNewPrivileges=yes --property=PrivateTmp=yes \
  --property=RuntimeMaxSec=120 \
  /usr/local/bin/bun run /var/lib/volition/operator-proofs/approval-mail-read-proof.ts \
  cards --expected-head=VERIFIED_LIVE_HEAD --id=EXISTING_ISSUE_ID
```

Das Skript setzt `default_transaction_read_only=on` in den Verbindungsoptionen und
prüft die Einstellung, bevor es den Proof beginnt. Ausgabe nur Hash, IDs,
Prüfzähler und Booleans; Fehler nur Phase/Zähler. Keine vollständigen Exceptions,
Envdateien, SQL-Ergebniszeilen oder Mailtexte ausgeben. Fehlende/mehrdeutige Daten
sind eine offene Vorbedingung, kein Anlass zu Mailänderungen.

## Punkt 3: Scope und Beschriftung

1. `cards` prüft die vorhandene `approvalScope`-Funktion mit einem bestehenden
   Ticket: `delete_issue {"issueId":N}` und „Ticket KEY-N endgültig löschen“ ergeben
   `workspace`; „Delete the Drive folder for KEY-N“ und explizit `external` bleiben
   `external`. Die vorhandene reine `levelRules(3)`-Auswertung liefert dazu
   `level-allows` bzw. `hard-block`. Es wird keine Aktion ausgeführt oder freigegeben.
2. Sichtbarer Weg: **Freigaben** (`/approvals`), bei bereits entschiedenen Karten
   `/approvals?status=decided`, projektbezogen `/project/KEY/approvals`.
   Bestehende Karten über `GET /approvals?status=pending&projectKey=KEY` bzw.
   `GET /approvals/ID` lesen. Bei einer **nach diesem Fix angelegten** internen
   Löschkarte erwartet: `scope=workspace`, `policyReason=level-allows`, sichtbarer
   Text „Innerhalb von Helena / Projektordner“ und „Stufe 3 … erlaubt das.“
   Externe Löschkarte: `external`, `hard-block`, „Außerhalb von Helena / Projektordner“.
   Historische Karten speichern ihren damaligen Grund; Scope kann dort `null` sein.
   Fehlt eine passende neue Karte, den UI-Fall offen lassen; keine realen
   Entscheidungen auslösen, nur um eine Testkarte zu erzeugen.
3. Bereits vorhandene Regressionen in
   `apps/api/src/modules/approvals/__tests__/integration/approvals.test.ts` prüfen
   echte POST/GET-Persistenz, interne/externe/mehrdeutige Löschung, falsche Projekte,
   Shellpfade sowie Execute unter Stufe 2. Nicht gegen die Live-DB starten.

## Punkt 4: numerische Helena-ID und Provider-ID

1. `mail` prüft den vorhandenen `resolveProjectThreadId`: dieselbe lokale ID über
   numerischen String, externen Providerkey ohne `thread:` und gespeicherten Key;
   zusätzlich eine nachweislich unbekannte riesige numerische Referenz → 404,
   keinesfalls Integerüberlauf/500. Es liest nur Thread-ID, Projekt-ID und Key.
   Ist der gewählte Providerkey mehrdeutig, verlangt die Funktion korrekt die
   lokale numerische ID; für den positiven Providerfall eine eindeutige vorhandene
   Referenz wählen und den mehrdeutigen Fall separat notieren.
2. Bereits authentifizierter echter API-Weg, falls ein Transportnachweis nötig ist:
   `GET /projects/KEY/mail/search?limit=1` (`search_mail`) liefert die lokale ID;
   `GET /projects/KEY/mail/threads/REFERENCE` (`read_mail`) muss für lokale/Provider-ID
   dieselbe `threadId` liefern. Nur Status und Gleichheit protokollieren.
   GET verändert weder Gelesenstatus noch Provider. Keine neue API-Key-/Loginaktion.
3. Die **UI** liegt unter `/project/KEY/inbox?thread=NUMERIC_ID`. Öffnen einer
   ungelesenen Mail sendet automatisch die Read-Aktion; daher für diese unverändernde
   Abnahme nicht verwenden. Ein vorhandenes Triage-Ticket darf read-only über seine
   Detailseite bzw. `GET /issues/ID` geprüft werden: Beschreibung enthält
   `**Helena thread ID:** N` und Link `/project/KEY/inbox?thread=N`.
   Den Mail-Link dabei nicht öffnen. Kein Triage-Neulauf nötig.
4. `POST /projects/KEY/mail/threads/REFERENCE/draft-reply` (`draft_reply`) schreibt
   tatsächlich einen lokalen Entwurf. Hier **nicht aufrufen**, auch wenn nichts
   versandt wird. Die bestehende private Suite
   `apps/api/src/modules/mail/__tests__/integration/mail-thread-references.test.ts`
   deckt Read + Draft mit `2147483648`, `9007199254740991`, noch längeren Zahlen,
   Hex-ID, numerischer Helena-ID, unbekannter ID und fremdem Projekt ab.

Der konkrete neue Fix beschränkt lokale int4-Lookups auf `<= 2147483647`; größere
Zahlen werden als Providerreferenz gesucht. Das erklärt den reproduzierbaren
Integerüberlauf. Eine historische Ursache von Run 118 darf nur dann als bewiesen
gelten, wenn dessen bereits ausgewerteter Fehlercode zum PostgreSQL-Überlauf passt;
die neue Regression allein ist kein nachträglicher Beleg für diesen einzelnen Run.

Abschluss je Punkt: Live-HEAD, Operator-Ergebnis, vorhandenes Fullgate, tatsächlich
sichtbare UI-/HTTP-Belege und verbleibende nicht ausgeführte Fälle getrennt nennen.

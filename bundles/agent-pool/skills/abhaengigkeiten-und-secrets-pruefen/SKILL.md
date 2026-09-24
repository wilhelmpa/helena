---
name: abhaengigkeiten-und-secrets-pruefen
description: Lieferketten- und Secret-Prüfung ohne Zusatzskripte – Abhängigkeiten auf bekannte Schwachstellen, verwaiste oder riskante Pakete, Install-Skripte und Lockfile-Drift prüfen; Repos und Konfiguration auf eingecheckte Secrets durchsuchen, ohne sie je auszugeben. Nutze ihn bei jedem Security-Review, vor Releases und bei neuen Abhängigkeiten.
---

# Abhängigkeiten und Secrets prüfen

Lesend und lokal. **Du installierst nichts**, aktualisierst nichts, rotierst keine Schlüssel und öffnest keine Tickets bei Dritten. Du lieferst Befunde mit Beleg und Vorschlag; Updates und Rotationen macht jemand anderes nach Freigabe.

## Teil A: Abhängigkeiten

### 1. Bestandsaufnahme
- Paketmanager und Lockfiles finden: `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `requirements*.txt`/`poetry.lock`/`uv.lock`, `go.sum`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`.
- Direkte vs. transitive Abhängigkeiten trennen; nur direkte kann das Projekt selbst ändern.

### 2. Bekannte Schwachstellen
Nur Werkzeuge nutzen, die **bereits installiert** sind (prüfen mit `command -v`); fehlt eines, als Lücke melden, nicht nachinstallieren:
| Ökosystem | Befehl (lesend) |
|---|---|
| npm/Bun | `npm audit --json --omit=dev` bzw. `bun audit` (falls vorhanden) |
| Python | `pip-audit -r requirements.txt` |
| mehrere | `osv-scanner --lockfile=<datei>` |
| Go | `govulncheck ./...` |
Ohne Werkzeug: Versionen der direkten Abhängigkeiten gegen Advisories recherchieren (GitHub Advisory Database, OSV, Hersteller-Changelog) – mit Link und Datum.

Für jeden Treffer: Paket, installierte Version, betroffene Versionen, behoben in, **ist der verwundbare Code überhaupt erreichbar?** (Import, Aufruf, nur Dev-Werkzeug?), Schwere nach eigener Einschätzung, nicht nur nach CVSS.

### 3. Riskante Pakete (auch ohne CVE)
- **Install-Skripte** (`preinstall`/`postinstall` in `package.json` der Abhängigkeit, `trustedDependencies` in Bun): wer führt beim Installieren Code aus?
- **Verwaist**: Repo archiviert, letzter Release > 2 Jahre, offene Security-Issues ohne Antwort.
- **Typosquatting / Verwechslung**: Name ähnelt einem bekannten Paket, sehr wenige Downloads, neuer Maintainer.
- **Unpinned**: `latest`, `*`, Git-URLs ohne Commit, `npx -y paket@latest` in Konfigurationen (lädt bei jedem Start neu).
- **Lockfile-Drift**: Lockfile fehlt, ist nicht eingecheckt oder passt nicht zur Manifest-Datei.
- **Überflüssig**: Abhängigkeit für eine Kleinigkeit, die die Standardbibliothek kann.

### 4. CI/CD
Bei GitHub Actions: Actions auf Commit-SHA gepinnt? `pull_request_target` mit Checkout fremden Codes? Secrets in Logs? (Details: Skill `gha-security-review`.)

## Teil B: Secrets

### Grundregel
**Nie einen Secret-Wert ausgeben, zitieren, in Kommentare, Notizen oder Logs schreiben** – auch nicht teilweise. Ein Befund nennt Datei, Zeile, Art („sieht aus wie AWS-Access-Key") und seit wann (Commit), niemals den Wert. Env-Dateien, `/etc/<dienst>/`, `auth.json`, Schlüsseldateien und Zugangsdaten-Speicher öffnest du nicht.

### Suchen (Treffer zählen und verorten, Werte nicht anzeigen)
```bash
# Dateien mit verdächtigen Mustern auflisten – nur Dateiname und Zeilennummer
git grep -nI -l -E '(api[_-]?key|secret|passw(or)?d|token|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-)' -- . ':!*.lock'
# In der Historie (nur Commits und Dateien, keine Inhalte)
git log --all -G 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}' --name-only --format='%h %ad %an' --date=short
```
Ist `gitleaks` oder `trufflehog` installiert: mit `--redact` bzw. ohne Ausgabe der Werte laufen lassen.
Jeder Treffer wird eingeordnet: echter Schlüssel / Platzhalter / Testwert / Beispiel. Im Zweifel als echt behandeln.

### Weitere Stellen
- `.env*`, `*.pem`, `*.key`, `id_*` im Repo eingecheckt? (nur Dateinamen prüfen: `git ls-files | grep -E '\.env|\.pem$|\.key$|id_(rsa|ed25519)'`)
- `.gitignore` deckt Env-Dateien ab?
- Secrets in Docker-Images, Build-Logs, Frontend-Bundles (Variablen mit `NEXT_PUBLIC_`/`VITE_`/`PUBLIC_` sind öffentlich!)
- Secrets in Kommandozeilen von Diensten (sichtbar in `ps`)?

## Ergebnis
```
## Lieferkette & Secrets: <Repo/Projekt> (<Datum>)
Werkzeuge: <was lief, was fehlte>
### Kritisch
1. <Paket@Version> – <CVE/GHSA> – erreichbar: ja (<wo>) – behoben in <Version> – Vorschlag: …
2. Secret-Verdacht: `pfad:zeile` (Art, seit Commit abc123) – Vorschlag: rotieren + aus Historie entfernen (Owner)
### Wichtig / Hinweise
…
### Geprüft ohne Befund
…
```
Rotation eines echten Secrets und das Umschreiben der Git-Historie sind Owner-Entscheidungen: als Aufgabe mit Priorität `urgent` vorschlagen, nicht selbst tun.

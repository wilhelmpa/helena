# Lesende Diagnose-Befehle

Alle Befehle hier ändern nichts. Trotzdem: Ausgaben begrenzen (`| tail -n 50`, `| head`, `grep -c`), keine Secrets ausgeben (Env-Dateien, Konfigs mit Passwörtern nie per `cat`).

## systemd
```bash
systemctl status <dienst> --no-pager            # Zustand, letzte Logzeilen, Hauptprozess
systemctl list-units --failed --no-pager        # was ist ausgefallen
systemctl show <dienst> -p ActiveState,SubState,NRestarts,ExecMainStatus,ActiveEnterTimestamp
systemctl cat <dienst>                          # Unit inkl. Drop-ins (keine Env-Dateien öffnen!)
systemctl list-timers --no-pager
```

## Logs (journald)
```bash
journalctl -u <dienst> --since "1 hour ago" --no-pager | tail -n 100
journalctl -u <dienst> -p err --since today --no-pager          # nur Fehler
journalctl -u <dienst> --since "2026-09-24 10:00" --until "2026-09-24 10:30" --no-pager
journalctl -b -1 -p warning --no-pager | tail -n 50             # voriger Boot
journalctl -u <dienst> --since today --no-pager | grep -c "ERROR"
```

## Ressourcen
```bash
uptime; free -h; df -h; df -i                   # Last, RAM, Platte, Inodes
ps -eo pid,user,%cpu,%mem,etime,cmd --sort=-%cpu | head -n 15
ss -ltnp                                         # lauschende Ports (Prozesse nur mit Rechten)
dmesg --ctime | tail -n 30                       # OOM-Killer, Hardware (kann Rechte brauchen)
```

## nginx
```bash
nginx -t                                         # Konfig prüfen (liest nur)
tail -n 100 /var/log/nginx/error.log
awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head   # Statuscodes
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' http://127.0.0.1/<pfad>
```

## Postgres (nur lesend)
```sql
SELECT now() - pg_postmaster_start_time() AS uptime;
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
SELECT pid, now() - query_start AS dauer, state, left(query, 80)
  FROM pg_stat_activity WHERE state <> 'idle' ORDER BY dauer DESC LIMIT 10;
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT * FROM pg_locks WHERE NOT granted;
```
Nur mit einer lesenden Rolle oder in einer Transaktion mit `SET TRANSACTION READ ONLY`.

## Git / Deploy-Stand
```bash
git -C <checkout> log --oneline -10
git -C <checkout> status --short                 # nur ansehen – nie reset/checkout/clean
```

## Cloudflare (Workers, D1, Pages) – nur lesend
Aus dem Projektordner, in dem `wrangler` als Abhängigkeit installiert ist (`npx` lädt sonst ein Paket nach – das ist eine Installation und braucht Freigabe).
```bash
npx wrangler deployments list                    # letzte Deploys
npx wrangler tail --format pretty                # Live-Logs (Ctrl+C beendet)
npx wrangler d1 execute <db> --remote --command "SELECT count(*) FROM <tabelle>"   # nur SELECT
```
`wrangler deploy`, `d1 execute` mit Schreibbefehlen, `secret put`: nur mit Freigabe.

## HTTP von außen
```bash
curl -sSI https://<domain>/                     # Status, Header, Cache
curl -sS https://<domain>/health                 # Health-Endpunkt, wenn vorhanden
openssl s_client -connect <domain>:443 -servername <domain> </dev/null 2>/dev/null | openssl x509 -noout -dates   # Zertifikat
```

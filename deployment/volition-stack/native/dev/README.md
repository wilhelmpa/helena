# Isolated Plan development instance

The live services run from `/srv/volition/source/plan`. Development happens in a separate
git worktree (for example `/srv/volition/source/plan-dev`) against a copy of the live
database, so an edit never reaches the running system before it is merged and deployed.

| | Live | Dev |
|---|---|---|
| Source | `/srv/volition/source/plan` | the worktree this script lives in |
| Database | `itsaplan` | `itsaplan_dev` (copy, refreshed on demand) |
| API / web | `127.0.0.1:3000` / `:3001` | `127.0.0.1:3100` / `:3101` |
| Entry | Nginx on port 80 | Nginx on the unix socket `/srv/volition/dev-run/plan-dev.sock` |
| Worker, provisioning, Mastra, Hermes | yes | no (nothing is provisioned from dev) |

The dev entry signs the owner in automatically, like the live local-owner mode. It is
safe only because the socket lives in a directory that root and the developer group
alone can traverse: agent users on Kingston cannot connect to it. Reach it from a
workstation through SSH:

```sh
ssh -N -L 8090:/srv/volition/dev-run/plan-dev.sock -p 2222 wilhelmpa@kingston-server.local
# then open http://localhost:8090
```

## Commands

```sh
sudo deployment/volition-stack/native/dev/setup.sh       # once: env file, Nginx entry, database copy
sudo deployment/volition-stack/native/dev/refresh-db.sh  # replace the dev database with a live copy
deployment/volition-stack/native/dev/start.sh            # API and web in the tmux session plan-dev
deployment/volition-stack/native/dev/stop.sh
```

`setup.sh` renders `/etc/volition/plan-dev.env` from the live `plan.env` without
printing any value. It points the database at `itsaplan_dev`, moves the ports, removes
the tool URLs and the Mastra control URL, and gives the dev instance its own local-owner
token. Logs are written to `~/.local/state/plan-dev/`.

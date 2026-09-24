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
| Helena engine (workflows, agent teams, routines) | in the API, on | in the API, off (`HELENA_ENGINE=off`) |
| Worker, provisioning, Hermes runner | yes | no (nothing is provisioned from dev; start a runner by hand to test agents) |

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
sudo deployment/volition-stack/native/dev/agent-runner.sh vol     # a project agent against the dev API
```

`agent-runner.sh` runs one project agent against the development API with a copy of its
Hermes profile, the runner built from this worktree and Hermes from
`/srv/volition/source/hermes-dev` (a worktree of the Hermes checkout on the branch
`volition/main`, where Hermes changes are made before they reach the live checkout). The
copy is removed when the runner stops.

`setup.sh` renders `/etc/volition/plan-dev.env` from the live `plan.env` without
printing any value. It points the database at `itsaplan_dev`, moves the ports, removes
the tool URLs and any `MASTRA_*` line left from before the Helena engine, and gives the
dev instance its own local-owner token and control token (`/etc/volition/dev`). Logs are
written to `~/.local/state/plan-dev/`.

The Helena engine runs inside the API, so the dev API would run it on the copied database:
the live instance's pending workflows, due schedules and queued runs would run a second
time, webhooks included. The dev env therefore sets `HELENA_ENGINE=off`. To test workflows
in dev, cancel the copied runs first, then set `HELENA_ENGINE=on` in
`/etc/volition/plan-dev.env` and restart the API window; `refresh-db.sh` brings the live
state back with the next copy.

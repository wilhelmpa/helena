# Halogen on Kingston: runbook

Decision and reasons: `docs/helena-decisions/halogen.md`. An optional host service like Lemonade:
Helena works unchanged without it (every class falls back to its configured model).

Host memory policy, measured limits, kernel research and maintenance steps:
[kernel.md](kernel.md). `install` writes and applies the scoped sysctl/THP files;
`status` compares installed files and runtime values. The unit enables weight mlock
at its next start, including with an existing settings file; that file can override it.
Kernel boot arguments remain a separate manual decision.

| File | What it is |
|---|---|
| `install.sh` | status, install (image by digest, MTP head and tokenizer, settings, network, firewall, unit, forwarders), weights check/pull, verify, cache status/clear, uninstall |
| `files.tsv` | every file Halogen reads: repository, revision, path, size, SHA-256 |
| `halogen.conf` | the tunables, copied once to `/etc/helena/halogen.conf` |
| `systemd/helena-halogen.service.in` | the unit, rendered by `install.sh` (`install.sh render unit` shows it) |
| `helena-halogen.nft.in` | the firewall table (`install.sh render nft`) |
| `systemd/helena-halogen-proxy@.{socket,service}` | the forwarder for agents in isolation (instance = port) |
| `wait-healthy` | the unit's start check: active once `/health` says the engine answers |
| `tests/` | `python3 -m unittest discover -s deployment/volition-stack/native/halogen/tests` |

## Install over the running Halogen (28 Sept setup)

Halogen already runs as `helena-halogen` from a hand-written unit. The installer keeps it running:
the new unit takes effect at the next restart.

1. `sudo ./install.sh status` — what is there (unit, image, firewall, weights, cache, health).
2. `sudo ./install.sh --dry-run install`, then `sudo ./install.sh install`:
   - image: already present by digest, no download;
   - MTP head and tokenizer: already in `/var/lib/helena-halogen/models`, checked by SHA-256;
   - `/etc/helena/halogen.conf` with 2 slots / 262,144 positions / 16,384 tokens and
     `HALOGEN_REASONING_EFFORT=medium` (an existing file is kept);
   - user `helena-halogen-fwd`, podman network `helena-halogen` (10.89.73.0/29, no DNS);
   - firewall table `inet helena_halogen` loaded (this blocks the test proxy
     `helena-halogen-biasproxy2`: stop it, `systemctl stop helena-halogen-biasproxy2`);
   - unit written and enabled, not restarted; forwarders `helena-halogen-proxy@8731/8733.socket`.
3. `sudo native/isolation.sh sync` — the agents' units get the `halogen`/`halogenquiet` forwards.
4. When no turn uses Halogen (Lokale KI card, `curl -s 127.0.0.1:8731/health` shows
   `"in_flight":0`): `sudo systemctl restart helena-halogen` (minutes: the weights map again; the
   unit is active once the model answers). Then `sudo ./install.sh status`: unit file current,
   firewall loaded, memory now shown (the container runs in the unit's cgroup), port 8733 answers.
5. Check the firewall: as the owner `curl -s 127.0.0.1:8731/health` answers; as another user
   (e.g. `sudo -u nobody curl -s 127.0.0.1:8731/health`) the connection is reset; from inside the
   container nothing leaves (`sudo podman exec halogen python3 -c "import urllib.request;
   urllib.request.urlopen('https://example.com', timeout=5)"` fails).

## Register in Helena

Administrator → Lokale KI → Server hinzufügen → Art **Halogen** (address and "Kein Schlüssel" are
preset; context 131072 lets two long agent turns share the KV pool), or as the API user:

```sh
sudo systemd-run --wait --pipe --collect --uid=volition-plan \
  -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
  /usr/local/bin/bun apps/api/src/scripts/local-ai-register.ts --kind halogen
```

With the master switch on, `helena-halogen/halogen-qwen3.8-flash-next` is in every model picker.

## Embeddings without Lemonade

```sh
sudo deployment/volition-stack/native/local-ai/embed.sh --dry-run install
sudo deployment/volition-stack/native/local-ai/embed.sh install
sudo systemd-run … bun apps/api/src/scripts/local-ai-register.ts --embeddings
```

`helena-embed` serves only Qwen3-Embedding-0.6B on 127.0.0.1:13308 with the local AI key, under the
name Lemonade used; `--embeddings` points the server `local` at it, so the vectors in the index stay
valid (they are named `helena-local/Qwen3-Embedding-0.6B-GGUF`).

## Phase 2, step 1 (only with the owner's OK)

```sh
sudo systemd-run … bun apps/api/src/scripts/local-ai-phase2.ts              # dry run
sudo systemd-run … bun apps/api/src/scripts/local-ai-phase2.ts --evaluate   # evals, one at a time
sudo systemd-run … bun apps/api/src/scripts/local-ai-phase2.ts --apply      # passed classes → prefer
```

## Updates

The update center lists Halogen (check only): the newest image tag on ghcr.io against the pinned
version, with the changelog. Taking an update: new digest and version in `install.sh`, `install`,
restart (owner's click / maintenance window). Rollback: the previous digest.
# Priority scheduling

`priority-install.sh install` starts `volition-halogen-priority.service` without restarting
Halogen. It listens on 127.0.0.1:8741 and :8743 for host API/worker/runner traffic and on
six Unix sockets for isolated agents. The launcher selects the chat, normal, or background
socket from the work kind. Isolated clients cannot select a priority with an HTTP header.
The service forwards to the existing Halogen ports 8731 and 8733, streams SSE without
buffering, and cancels the upstream request when its client disconnects.

The Local AI policy controls slot limits, background concurrency, queue length, and queue
timeout. The proxy reloads it from PostgreSQL every five seconds. Its queue and active counts
are available at `http://127.0.0.1:8741/priority/status` and through the owner Local AI status
API. A request whose proxy wait expires receives HTTP 503 with `Retry-After`. The reservation
is a slot reservation; Halogen's separate shared KV pool can still make an admitted chat wait
for memory when long requests have filled it.

Run the installer only after the branch is in the live checkout and the in-flight agent work
has drained. It synchronizes the isolation launcher and then disables the old socket proxies.
The installer does not restart `helena-halogen`.

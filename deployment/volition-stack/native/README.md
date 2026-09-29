# Native Web releases from a build host

The server runs Linux x86_64. Build the production `standalone` release in a Linux x86_64
container, even when the build host is an Apple Silicon Mac. A native macOS build is not a
portable server release: the traced `node_modules` may contain Darwin binaries, notably
`sharp`. `next/font` emits static assets during the build; these assets travel with the
release. `NEXT_PUBLIC_*` values would be frozen at build time, so the build script passes
none. This app passes origins to the browser from server runtime environment instead.
`NEXT_DEPLOYMENT_ID` is the first 12 hex characters of the commit, as in `web-release.sh`.
Next.js generates a Server Actions encryption key in the output; one artifact serves the
single live server. If several servers must share one build, use the **same artifact** on
all of them; a separately built release needs a shared key supplied at build time. Never
send that key to an untrusted build host.

The build cache for `next build` is experimental in Next 16, so this workflow opts in only
inside the build container. The cache lives under `~/volition-web-build/cache`, while
the released tarball contains only `standalone`, `static`, `public`, `manifest.json` and
`SHA256SUMS`. `typescript.ignoreBuildErrors` is enabled only with
`VOLITION_GATED_BUILD=1`; run the full gate including `bun run typecheck` **for the exact
commit** before this workflow. Regular local builds keep Next's type check.

## Build on the Mac and send to Kingston

On the Mac, Docker Desktop must use Apple Virtualization with Rosetta enabled and have
the pinned `oven/bun:1.4.0` and `node:24-bookworm-slim` base images available. Building
`linux/amd64` on Apple Silicon uses emulation; it is correct for the target ABI but can
be slow. The script checks out no server files: `ssh git rev-parse`, `git archive` and
`git show` only read the server repository. It copies only a tarball into Kingston's
incoming folder. Docker's build stage installs dependencies from `bun.lock`, with Bun's
download cache persisted on the Mac. No `.env`, service credential or owner account is
loaded into the build.

```sh
SHA=<full SHA of the gated commit>
cd ~/volition
deployment/volition-stack/native/build-web-release.sh "$SHA"
```

The script prints `build_seconds`, `container_peak_bytes`, the local archive and the remote
incoming path. On Kingston, after the branch has been pushed and the exact commit has
passed the gate, deploy with the archive. `--expect` is mandatory for artifacts.

```sh
SHA=<same full SHA>
sudo /srv/volition/source/plan/deployment/volition-stack/native/deploy.sh \
  --expect "$SHA" \
  --web-artifact "/home/wilhelmpa/agent-work/web-artifacts/incoming/web-${SHA:0:12}.tar.gz" \
  hub/build-extern
```

The new deploy script checks the commit, target `bun.lock` SHA-256, every packaged file,
symlinks and Linux x86_64 native modules before its drain and checkout. On the first
deployment from the older live script, verification happens after its checkout handoff;
failure enters the existing rollback. It checks again before
installing a new `web-releases` directory, copies old static chunks, switches `current`,
smokes the web service and uses the existing rollback path on failure.

Without an artifact, `deploy.sh` still builds locally, but only when available memory
plus free swap is at least 16 GiB. The build runs in a systemd scope with
`MemoryHigh=10G`, `MemoryMax=14G`, and `CPUWeight=20`; `--force-local-build` only bypasses
the preflight memory threshold. It does not remove the scope limits.

| Scenario | Duration | Peak memory |
| --- | --- | --- |
| Kingston build observed 2026-09-29 | 40 minutes before OOM | about 15 GB build, 14 GB swap |
| Mac Linux x86_64 cold build | Measure from script output | Measure from script output |
| Mac Linux x86_64 warm build | Measure from a second script run | Measure from script output |

The target of under three minutes for an incremental Mac build is not yet established;
record the two Mac measurements before using that target for planning. Docker documents
slow AMD64 emulation without Rosetta; a native Linux x86_64 build host is the preferred
way to reach the speed target if the Mac's emulated build is too slow.

The build still uses `output: 'standalone'` and `outputFileTracingRoot` at the monorepo
root; tracing is needed for the current workspace packages. `voice-assets.mjs` copies four
files and skips unchanged copies, and brand files travel in `public/`. Production browser
source maps are not enabled. The release build does not run separate package builds; the
small Runner bundle remains on Kingston for now. The Mac measurements will show whether
tracing or packaging, rather than compilation, becomes the next bottleneck.

Sources: [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting),
[standalone output and tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[Turbopack filesystem cache](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache),
[TypeScript build setting](https://nextjs.org/docs/app/api-reference/config/next-config-js/typescript),
[sharp platform packages](https://sharp.pixelplumbing.com/install/),
[Docker VMM and Rosetta](https://docs.docker.com/desktop/features/vmm/).

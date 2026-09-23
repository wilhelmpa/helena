# syntax=docker/dockerfile:1.7

FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node_runtime
FROM docker.io/oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun_runtime
FROM docker.io/oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS bun_itsaplan_runtime

FROM ghcr.io/coder/code-server:4.138.0@sha256:81706b71ace316157850cbcfb574714d1067249c107a415b3a03dc6b613ebfbc

USER root

# ttyd is intentionally kept inside the existing non-root workspace container.
# It exposes a human terminal for the mounted projects without creating an
# unsandboxed legacy runtime agent or granting access to the host Docker socket/home.
ADD --checksum=sha256:8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55 \
    https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 \
    /usr/local/bin/ttyd

COPY --from=node_runtime /usr/local/ /usr/local/
COPY --from=bun_runtime /usr/local/bin/bun /opt/bun/1.4.2/bun
COPY --from=bun_itsaplan_runtime /usr/local/bin/bun /opt/bun/1.4.0/bun
COPY bun-wrapper.sh /usr/local/bin/bun
COPY bunx-wrapper.sh /usr/local/bin/bunx
COPY git-ssh-wrapper.sh /usr/local/bin/volition-git-ssh
COPY terminal-session.sh /usr/local/bin/volition-terminal-session
RUN apt-get update \
    && apt-get install -y --no-install-recommends tmux=3.5a-3 python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/local/bin/fixuid \
    && rm -rf /etc/fixuid \
    && chmod 0755 /usr/local/bin/ttyd \
    /usr/local/bin/bun /usr/local/bin/bunx /opt/bun/1.4.0/bun /opt/bun/1.4.2/bun \
    /usr/local/bin/volition-git-ssh /usr/local/bin/volition-terminal-session \
    && ln -s /opt/bun/1.4.0/bun /usr/local/bin/bun-1.4.0 \
    && ln -s /opt/bun/1.4.2/bun /usr/local/bin/bun-1.4.2 \
    && npm install --global npm@12.0.2 \
    && mkdir -p /tmp/npm-security \
    && npm pack --silent --pack-destination /tmp/npm-security \
    brace-expansion@5.0.9 ip-address@10.4.0 tar@7.5.22 \
    && for package in brace-expansion ip-address tar; do \
    rm -rf "/usr/local/lib/node_modules/npm/node_modules/${package}"; \
    mkdir -p "/usr/local/lib/node_modules/npm/node_modules/${package}"; \
    done \
    && tar -xzf /tmp/npm-security/brace-expansion-5.0.9.tgz --strip-components=1 \
    -C /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && tar -xzf /tmp/npm-security/ip-address-10.4.0.tgz --strip-components=1 \
    -C /usr/local/lib/node_modules/npm/node_modules/ip-address \
    && tar -xzf /tmp/npm-security/tar-7.5.22.tgz --strip-components=1 \
    -C /usr/local/lib/node_modules/npm/node_modules/tar \
    && rm -rf /tmp/npm-security \
    && npm install --global pnpm@12.5.1 \
    && npm cache clean --force \
    && mkdir -p /etc/volition-workspace /projects \
    && chown 1000:1000 /projects

COPY codex-install.sh /opt/volition/install-codex.sh
RUN CODEX_HOME=/opt/codex-seed CODEX_INSTALL_DIR=/usr/local/bin \
    sh /opt/volition/install-codex.sh --release 0.155.1
RUN npm install --global --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code@2.1.278 \
    && claude --version \
    && npm cache clean --force
ENV DISABLE_AUTOUPDATER=1
COPY codex-remote.sh /usr/local/bin/volition-codex-remote
RUN chmod 0755 /usr/local/bin/volition-codex-remote

COPY --chown=1000:1000 settings.json /etc/volition-workspace/settings.json
COPY --chown=1000:1000 entrypoint.sh /usr/local/bin/volition-workspace
RUN chmod 0755 /usr/local/bin/volition-workspace

USER 1000:1000
WORKDIR /projects

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/volition-workspace"]

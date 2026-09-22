# syntax=docker/dockerfile:1.7

# Reuse the audited human workspace toolchain, but retain OpenClaw's sandbox
# lifecycle contract: the agent receives its own bind mounts, starts idle, and
# never launches the IDE/terminal entrypoint.
FROM volition/code-workspace:4.138.0-node24.21.0-bun1.4.2-v3
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT []
CMD ["sleep", "infinity"]

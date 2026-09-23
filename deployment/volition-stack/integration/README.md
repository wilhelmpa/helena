# Volition integration

The integration service provisions project resources, routes mail and project-file operations, and exposes authenticated Connections and Vault metadata APIs.

- Connections reports Hermes, Nextcloud, and document-archive health. Only bounded probe actions are accepted.
- Vault inventory is Hermes metadata only. Values are never returned and changes are managed through Vaultwarden.
- Inbox triage is Mastra-only and read-only. It receives bounded, untrusted message data and returns validated JSON.
- Theme synchronization updates Code and Nextcloud. It does not call an agent runtime.
- Project provisioning (`POST /api/provision`) creates or removes a project's resources, once per event id. `GET /api/provision/state` reports the provisioning registry to the worker, which repairs differences from the database every ten minutes. `purge-trash.mjs` deletes expired trash entries; `native/systemd/volition-trash-purge.timer` runs it daily.
- Every agent in a provisioning request's `agents` list runs in a Hermes runtime of its own: the profile `profiles/<slug>_<agentId>` and the runner descriptor `run/agents/<slug>_<agentId>.json`, with the project's workspace as working directory and the project's browser. The agent id keeps the profile when the agent is renamed. The key comes from `POST /internal/bootstrap/project-agent` with the control token; Plan issues a new one only when the stored key no longer works. A runtime whose agent is no longer in the list is removed: the descriptor is deleted because it holds the key, and the profile moves to the project trash. The Hermes runner is restarted after each change, because it reads the descriptors only when it starts.
- Plan sends an agent only while it works in this one project. The runner claims an agent's runs from all of its projects with one working directory and one memory, so an agent that works in several projects has no runtime.

All bearer values are loaded from private files. Do not place credentials in this repository or service logs.

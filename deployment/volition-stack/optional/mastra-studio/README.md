# Volition Mastra control plane

This project exposes six typed Mastra 1.67 workflows in Studio:

- `inbox-triage`
- `career-research`
- `application`
- `support`
- `system-audit`
- `document-filing`

Each workflow accepts the shared envelope in `src/mastra/contracts.ts`, builds a
deterministic effect plan, and passes it through an approval gate. With
`dryRun: true`, every effect is simulated. With `dryRun: false`, an external
write or send suspends the run. Approval resumes the run as `needs-attention`;
it still does not execute that gated effect.

`inbox-triage` uses the provider-neutral `ClassifierAdapter` and capability
reference `inbox-triage.v1`. The adapter knows no provider, model, agent ID or
mail credential. It calls one authenticated private endpoint; the host-side
integration owns the current runtime implementation and validates the result.
The existing Plan worker remains the sole inbox and ticket writer. All other
flows, including provider-neutral `document-store.v1`, still use local planning
previews only. `src/mastra/triggers.ts` maps
supported event names to workflow IDs.

## Verification

```sh
npm test
npm run build
docker build -t volition/mastra-studio:control-plane-test .
```

The front proxy requires the authenticated owner headers, limits workflow POST
bodies to 128 KiB, and permits POST only for registered workflow start/resume
routes. Other mutation routes remain blocked.

Building this directory does not update the live Compose service. Deployment is
a separate operation.

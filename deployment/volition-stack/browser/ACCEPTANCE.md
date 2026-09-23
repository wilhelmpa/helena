# Project browser acceptance

This checklist validates the project browser factory without modifying an existing project profile or external account.

## Static and installer checks

```bash
bash -n deployment/volition-stack/browser/install.sh
systemd-analyze --user verify \
  deployment/volition-stack/browser/systemd/volition-project-browser@.target \
  deployment/volition-stack/browser/systemd/volition-project-browser-xvfb@.service \
  deployment/volition-stack/browser/systemd/volition-project-browser-chromium@.service \
  deployment/volition-stack/browser/systemd/volition-project-browser-vnc@.service \
  deployment/volition-stack/browser/systemd/volition-project-browser-novnc@.service \
  deployment/volition-stack/browser/systemd/volition-project-browser-router.service
```

A factory dry-run may install shared assets and templates, but it must not enable a global browser target or create a shared login profile. Only the loopback router is enabled globally. Project targets are enabled by the canonical Plan provisioning job.

## Project isolation

For a disposable project, verify:

- the project root, profile, cache, home, and run directories are private and not symlinks;
- `runtime.json`, `runtime.env`, and `Xauthority` use mode `0600`;
- another project receives a different slot and different loopback ports;
- provisioning results contain only the opaque profile id and authenticated Plan URL;
- no local path, CDP port, cookie, Xauthority value, or token reaches Plan or logs.

## Network and recovery

After provisioning `<slug>`:

```bash
systemctl --user status volition-project-browser@<slug>.target
ss -ltn
```

CDP, VNC, noVNC, and the router must bind only to `127.0.0.1`. Xvfb must use `-nolisten tcp`. The CDP `/json/version` response must advertise exactly `ws://127.0.0.1:<assigned-port>/devtools/browser/...`.

Stop one project browser service and repeat provisioning. The bounded recovery path must restart that project target once, recover CDP, and leave every other project untouched.

## Plan and Hermes end to end

From an authenticated Plan session, open:

```text
/browser/projects/<slug>/vnc.html?autoconnect=1&resize=scale&path=browser%2Fprojects%2F<slug>%2Fwebsockify
```

The page must upgrade its WebSocket through the same authenticated Plan origin.

Run the Hermes smoke helper against a disposable profile:

```bash
deployment/volition-stack/integration/scripts/volition-hermes-browser-smoke.py <slug>
```

It must use the project's loopback `BROWSER_CDP_URL`, invoke the official Hermes browser tool, navigate the fixed public smoke page, and return only bounded success metadata. It must not print the CDP endpoint or any secret.

## Persistence

Write a harmless marker to the disposable project's browser profile, restart `volition-project-browser@<slug>.target`, and verify the marker remains. Remove the marker afterwards. Do not use real credentials for acceptance.

## Rollback

Stopping the project target and loopback router removes access without deleting project profiles:

```bash
systemctl --user stop volition-project-browser@<slug>.target
systemctl --user stop volition-project-browser-router.service
```

Preserve project directories for recovery unless their explicit deletion has been separately approved.

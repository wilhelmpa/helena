import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config.mjs";

describe("loadConfig", () => {
  it("defaults to loopback and accepts a dedicated bridge address", () => {
    assert.equal(loadConfig({ HOME: "/home/pw" }).host, "127.0.0.1");
    assert.equal(
      loadConfig({ HOME: "/home/pw", PROVISIONING_HOST: "172.30.254.1" }).host,
      "172.30.254.1",
    );
  });

  it("rejects wildcard, public and hostname bind targets", () => {
    for (const host of ["0.0.0.0", "203.0.113.5", "provision.example.com"]) {
      assert.throws(
        () => loadConfig({ HOME: "/home/pw", PROVISIONING_HOST: host }),
        /must be a loopback or RFC1918 address/,
      );
    }
  });

  it("allows an explicit wildcard bind for an isolated container network", () => {
    assert.equal(
      loadConfig({
        HOME: "/home/pw",
        PROVISIONING_HOST: "0.0.0.0",
        PROVISIONING_ALLOW_WILDCARD_BIND: "true",
      }).host,
      "0.0.0.0",
    );
  });

  it("restricts the Gateway transport to unauthenticated loopback WebSockets", () => {
    assert.equal(loadConfig({ HOME: "/home/pw" }).openClawGatewayUrl, "ws://127.0.0.1:18789/");
    for (const url of [
      "wss://openclaw.example.com",
      "ws://192.168.1.5:18789",
      "ws://user:secret@127.0.0.1:18789",
      "ws://127.0.0.1:18789/path",
    ]) {
      assert.throws(
        () => loadConfig({ HOME: "/home/pw", OPENCLAW_GATEWAY_URL: url }),
        /loopback WebSocket URL/,
      );
    }
  });

  it("requires a valid dedicated inbox classifier ID", () => {
    assert.equal(loadConfig({ HOME: "/home/pw" }).inboxAgentId, "inbox-classifier");
    assert.equal(loadConfig({ HOME: "/home/pw", OPENCLAW_INBOX_AGENT_ID: "custom-classifier" }).inboxAgentId, "custom-classifier");
    for (const invalid of ["../owner", "a b", "-x", "agent;rm", "a".repeat(65)]) {
      assert.throws(() => loadConfig({ HOME: "/home/pw", OPENCLAW_INBOX_AGENT_ID: invalid }), /dedicated agent ID/);
    }
  });

  it("uses an owner-controlled coordinator policy path", () => {
    assert.equal(
      loadConfig({ HOME: "/home/pw" }).coordinatorPolicyPath,
      "/home/pw/.openclaw/volition/coordinator-policy.json",
    );
    assert.equal(
      loadConfig({
        HOME: "/home/pw",
        OPENCLAW_COORDINATOR_POLICY_FILE: "/private/coordinator-policy.json",
      }).coordinatorPolicyPath,
      "/private/coordinator-policy.json",
    );
    assert.throws(
      () =>
        loadConfig({
          HOME: "/home/pw",
          OPENCLAW_COORDINATOR_POLICY_FILE: "relative-policy.json",
        }),
      /must be absolute/,
    );
  });

  it("validates the Plan coordinator organization defaults", () => {
    const configured = loadConfig({
      HOME: "/home/pw",
      PLAN_DEFAULT_DEPARTMENT_NAME: "Quality & Operations",
      PLAN_SECRET_ALLOW_HOST: "plan-api.example.com",
    });
    assert.equal(configured.planDefaultDepartmentName, "Quality & Operations");
    assert.equal(configured.planSecretAllowHost, "plan-api.example.com");
    assert.throws(
      () => loadConfig({ HOME: "/home/pw", PLAN_SECRET_ALLOW_HOST: "https://bad.example" }),
      /PLAN_SECRET_ALLOW_HOST is invalid/,
    );
  });

  it("rejects unknown triage transports", () => {
    assert.throws(
      () => loadConfig({ HOME: "/home/pw", OPENCLAW_TRIAGE_TRANSPORT: "auto" }),
      /must be cli or rpc/,
    );
  });

  it("keeps optional communications integrations opt-in", () => {
    const defaults = loadConfig({ HOME: "/home/pw" });
    assert.equal(defaults.connectionsEnabled, false);
    assert.equal(defaults.mailEnabled, false);
    const enabled = loadConfig({
      HOME: "/home/pw",
      CONNECTIONS_ENABLED: "true",
      MAIL_ENABLED: "true",
    });
    assert.equal(enabled.connectionsEnabled, true);
    assert.equal(enabled.mailEnabled, true);
  });

  it("allows only the known portable internal service names", () => {
    const portable = loadConfig({
      HOME: "/home/pw",
      NEXTCLOUD_INTERNAL_URL: "http://nextcloud",
      PLAN_INTERNAL_URL: "http://api:3000",
      INBOX_WORKER_WAKE_URL: "http://worker:18801/internal/inbox/wake",
    });
    assert.equal(portable.nextcloudInternalUrl, "http://nextcloud/");
    assert.equal(portable.planInternalUrl, "http://api:3000/");
    assert.equal(
      portable.inboxWorkerWakeUrl,
      "http://worker:18801/internal/inbox/wake",
    );

    for (const [name, value] of [
      ["NEXTCLOUD_INTERNAL_URL", "http://nextcloud.example.com"],
      ["PLAN_INTERNAL_URL", "http://api.example.com:3000"],
      [
        "INBOX_WORKER_WAKE_URL",
        "http://worker.example.com:18801/internal/inbox/wake",
      ],
    ]) {
      assert.throws(() => loadConfig({ HOME: "/home/pw", [name]: value }));
    }
  });

  it("does not expose unknown archive configuration", () => {
    const config = loadConfig({
      HOME: "/home/pw",
      DOCUMENT_ARCHIVE_INTERNAL_URL: "http://127.0.0.1:5555",
      DOCUMENT_ARCHIVE_PUBLIC_URL: "https://archive.example.com",
    });
    assert.equal(config.documentArchiveInternalUrl, undefined);
    assert.equal(config.documentArchivePublicUrl, undefined);
    assert.equal(config.documentArchiveTokenFile, undefined);
  });
});

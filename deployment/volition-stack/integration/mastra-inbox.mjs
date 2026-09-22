import crypto from "node:crypto";

function deterministicUuid(value) {
  const hex = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function triageResult(value) {
  if (!value || typeof value !== "object" || value.status !== "completed" || !value.triage) {
    throw new Error("The inbox workflow returned no completed classification");
  }
  return value.triage;
}

export function createMastraInboxRunner(config, options = {}) {
  const request = options.fetch ?? fetch;
  return {
    async run(input) {
      const eventId = deterministicUuid(input);
      const envelope = {
        eventId,
        correlationId: input.thread.id,
        occurredAt: input.thread.receivedAt,
        source: "hub-inbox",
        actor: { type: "service", id: "itsaplan-worker" },
        context: {
          organizationRef: config.mastraInboxOrganizationRef,
          projectRef: config.mastraInboxProjectRef,
          capabilityRefs: [config.mastraInboxCapabilityRef],
          connectionRefs: [],
        },
        dryRun: false,
        payload: input,
      };
      const response = await request(config.mastraInboxUrl, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(340_000),
        headers: {
          authorization: `Bearer ${config.mastraInboxToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(envelope),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`Mastra inbox workflow returned HTTP ${response.status}`);
      if (Buffer.byteLength(raw) > 64 * 1024) throw new Error("Mastra inbox workflow response is too large");
      try {
        return triageResult(JSON.parse(raw));
      } catch {
        throw new Error("Mastra inbox workflow returned an invalid result");
      }
    },
  };
}

"""Helena approval guard: the Autopilot's adapter in Hermes.

In a run or a chat answer of a Helena agent (``ITSAPLAN_RUN_ID`` or ``ITSAPLAN_MESSAGE_ID`` is
set), Hermes asks Helena's policy engine before every tool call, including reads
(POST /agent-policy/decide). Helena classifies the call into an action category (write, send,
delete, pay, publish, execute, credentials), applies the Autopilot level of the project and
its budgets, logs the decision, and answers allow, needs-approval or deny with the message the
agent reads. A call that is not allowed is blocked with that message; a command a person
approved exactly, in a request whose decision started this run, is allowed by the engine.

Helena's own MCP tools are checked by Helena itself when they arrive, so they pass here.
The server also decides about Hermes' scheduler; Home has the owner's full tool access.
Hermes sessions started outside the Helena runner are left to Hermes' own approval settings.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Any

from tools.approval_detection import detect_dangerous_command

# Below Hermes' pre_tool_call timeout (plugins.hook_callback_timeout, 30 seconds by default),
# which would block the call with a less helpful message.
PLAN_TIMEOUT_SECONDS = 10

CRON_MESSAGE = (
    "BLOCKED: Hermes cron jobs are not used here. Recurring work is a routine in Helena, which "
    "a person sets up on the project's Schedules page; a Hermes job would run the work twice."
)

# The MCP servers whose tools Helena checks itself when they arrive: Helena's own.
SERVER_SIDE_MCP = {
    name.strip()
    for name in os.environ.get("HELENA_POLICY_SERVER_MCP", "itsaplan,helena,plan").split(",")
    if name.strip()
}


def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    url = f"{os.environ['ITSAPLAN_URL'].rstrip('/')}{path}"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-api-key": os.environ["ITSAPLAN_API_KEY"], "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=PLAN_TIMEOUT_SECONDS) as response:
        value = json.load(response)
    if not isinstance(value, dict):
        raise ValueError("Helena answered with an unexpected body")
    return value


def mcp_tool_info(tool_name: str) -> tuple[str, bool] | None:
    """The raw MCP server of a registered MCP tool and whether its discovery annotations say it
    only reads, or None for a Hermes tool. Missing metadata counts as write-capable."""
    try:
        from tools import mcp_tool as core  # noqa: PLC0415 - Hermes internals, only when present

        server = core._mcp_tool_server_names.get(tool_name)  # noqa: SLF001
        if not server:
            return None
        try:
            from tools.mcp_tool_scope import _resolve_server_key  # noqa: PLC0415

            hints = core._tool_read_only_hints.get(_resolve_server_key(server), {})  # noqa: SLF001
        except Exception:  # noqa: BLE001
            hints = {}
        read_only = any(
            value is True and tool_name.endswith(re.sub(r"[^A-Za-z0-9_]", "_", name))
            for name, value in hints.items()
        )
        return server, read_only
    except Exception:  # noqa: BLE001 - an older Hermes without these internals
        return None


def block_message(tool_name: str, args: dict[str, Any]) -> str | None:
    mcp = mcp_tool_info(tool_name)
    if mcp is not None:
        server, read_only = mcp
        if server in SERVER_SIDE_MCP:
            return None

    body: dict[str, Any] = {"runtime": "hermes", "tool": tool_name[:200], "workspace": os.getcwd()}
    run_id = os.environ.get("ITSAPLAN_RUN_ID", "")
    message_id = os.environ.get("ITSAPLAN_MESSAGE_ID", "")
    if run_id.isdigit():
        body["runId"] = int(run_id)
    elif message_id.isdigit():
        body["messageId"] = int(message_id)
    if tool_name == "terminal" and isinstance(args.get("command"), str):
        body["command"] = args["command"]
        dangerous, _, _ = detect_dangerous_command(args["command"])
        body["dangerous"] = bool(dangerous)
    elif tool_name == "execute_code" and isinstance(args.get("code"), str):
        body["command"] = args["code"]
    elif isinstance(args.get("path"), str):
        body["path"] = args["path"]
    if mcp is not None:
        body["mcp"] = {"server": mcp[0], "annotations": {"readOnlyHint": mcp[1]}}

    decision = _post("/agent-policy/decide", body)
    if decision.get("outcome") == "allow":
        return None
    message = decision.get("message")
    return message if isinstance(message, str) and message else "BLOCKED by Helena's Autopilot."


def check_tool_call(tool_name: str = "", args: Any = None, **_: Any) -> dict[str, str] | None:
    if not os.environ.get("ITSAPLAN_RUN_ID") and not os.environ.get("ITSAPLAN_MESSAGE_ID"):
        if tool_name == "cronjob_manage":
            return {"action": "block", "message": CRON_MESSAGE}
        return None
    try:
        message = block_message(tool_name, args if isinstance(args, dict) else {})
    except Exception as exc:  # noqa: BLE001 - Hermes lets the call run when a hook raises
        message = (
            f"BLOCKED: Helena could not decide on this call ({exc}). Do not run it or reach the "
            "same result another way; end the run and report the problem."
        )
    return {"action": "block", "message": message} if message else None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", check_tool_call)

"""Helena approval guard: the Autopilot's adapter in Hermes.

In a run or a chat answer of a Helena agent (``ITSAPLAN_RUN_ID`` or ``ITSAPLAN_MESSAGE_ID`` is
set), Hermes asks Helena's policy engine before each tool call that is not a plain read
(POST /agent-policy/decide). Helena classifies the call into an action category (write, send,
delete, pay, publish, execute, credentials), applies the Autopilot level of the project and
its budgets, logs the decision, and answers allow, needs-approval or deny with the message the
agent reads. A call that is not allowed is blocked with that message; a command a person
approved exactly, in a request whose decision started this run, is allowed by the engine.

Helena's own MCP tools are checked by Helena itself when they arrive, so they pass here.
Hermes' hard block list is never approvable. Hermes' own scheduler is blocked everywhere:
Helena schedules work through its routines, so a Hermes cron job would run the work twice.
Hermes sessions started outside the Helena runner are left to Hermes' own approval settings.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from tools.approval_detection import detect_dangerous_command, detect_hardline_command

# Below Hermes' pre_tool_call timeout (plugins.hook_callback_timeout, 30 seconds by default),
# which would block the call with a less helpful message.
PLAN_TIMEOUT_SECONDS = 10

CRON_MESSAGE = (
    "BLOCKED: Hermes cron jobs are not used here. Recurring work is a routine in Helena, which "
    "a person sets up on the project's Schedules page; a Hermes job would run the work twice."
)

# Hermes tools that only read or only talk within the task: every Autopilot level allows them,
# so they do not wait for a round trip to Helena.
READ_TOOLS = {
    "web_search",
    "web_extract",
    "read_file",
    "search_files",
    "vision_analyze",
    "skills_list",
    "skill_view",
    "session_search",
    "browser_navigate",
    "browser_snapshot",
    "browser_scroll",
    "browser_back",
    "browser_get_images",
    "browser_vision",
    "browser_console",
    "browser_vault_list",
    "ha_list_entities",
    "ha_get_state",
    "ha_list_services",
    "kanban_show",
    "kanban_list",
    "kanban_attachments",
    "todo_list",
    "memory",
    "clarify",
    "delegate_task",
}

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


def approved_commands(run_id: str) -> list[str]:
    """The commands approved for this run, for a Helena that predates the policy engine."""
    if not run_id.isdigit():
        raise ValueError("ITSAPLAN_RUN_ID is not a run id")
    url = f"{os.environ['ITSAPLAN_URL'].rstrip('/')}/agent-runs/{run_id}/approved-commands"
    request = urllib.request.Request(url, headers={"x-api-key": os.environ["ITSAPLAN_API_KEY"]})
    with urllib.request.urlopen(request, timeout=PLAN_TIMEOUT_SECONDS) as response:
        commands = json.load(response)
    if not isinstance(commands, list):
        raise ValueError("Helena answered with an unexpected body")
    return commands


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


def _legacy_block(tool_name: str, text: str, subject: str, reason: str) -> str | None:
    """The guard's behaviour before the policy engine: a dangerous command or any code needs a
    person's approval of exactly that text."""
    if tool_name == "terminal":
        dangerous, _, description = detect_dangerous_command(text)
        if not dangerous:
            return None
        reason = f"it is flagged as dangerous: {description}"
    approved = {c.strip() for c in approved_commands(os.environ.get("ITSAPLAN_RUN_ID", ""))}
    if text.strip() in approved:
        return None
    return (
        f"BLOCKED: this {subject} needs a person's approval in Helena ({reason}). If it is "
        "needed, call Helena's request_approval tool with the kind that fits, the action in one "
        f"line and exactly this {subject} in command, then end your run without running it."
    )


def block_message(tool_name: str, args: dict[str, Any]) -> str | None:
    if tool_name == "terminal":
        command = args.get("command")
        if isinstance(command, str):
            hardline, description = detect_hardline_command(command)
            if hardline:
                return (
                    f"BLOCKED: {description}. Hermes never runs this command, not even with an "
                    "approval, so do not request one."
                )
    if tool_name in READ_TOOLS:
        return None
    mcp = mcp_tool_info(tool_name)
    if mcp is not None:
        server, read_only = mcp
        if server in SERVER_SIDE_MCP or read_only:
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

    try:
        decision = _post("/agent-policy/decide", body)
    except urllib.error.HTTPError as error:
        if error.code != 404 or not run_id:
            raise
        # A Helena without the policy engine: only commands and code are checked, as before.
        if tool_name == "terminal" and isinstance(args.get("command"), str):
            return _legacy_block(tool_name, args["command"], "command", "")
        if tool_name == "execute_code" and isinstance(args.get("code"), str):
            return _legacy_block(
                tool_name, args["code"], "code", "execute_code runs arbitrary Python"
            )
        return None
    if decision.get("outcome") == "allow":
        return None
    message = decision.get("message")
    return message if isinstance(message, str) and message else "BLOCKED by Helena's Autopilot."


def check_tool_call(tool_name: str = "", args: Any = None, **_: Any) -> dict[str, str] | None:
    if tool_name == "cronjob_manage":
        return {"action": "block", "message": CRON_MESSAGE}
    if not os.environ.get("ITSAPLAN_RUN_ID") and not os.environ.get("ITSAPLAN_MESSAGE_ID"):
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

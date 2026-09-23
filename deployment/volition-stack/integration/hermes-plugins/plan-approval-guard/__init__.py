"""Plan approval guard.

In a run of a Plan agent (``ITSAPLAN_RUN_ID`` is set), a terminal command that Hermes classifies
as dangerous and every execute_code script run only when a person approved exactly that text in
Plan, for this run. Hermes' hard block list is never approvable. Chats and Hermes sessions
started outside the Plan runner are left to Hermes' own approval settings.

Hermes' own scheduler is blocked everywhere: Plan schedules work through its routines, so a
Hermes cron job would run the work a second time.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

from tools.approval_detection import detect_dangerous_command, detect_hardline_command

# Below Hermes' pre_tool_call timeout (plugins.hook_callback_timeout, 30 seconds by default),
# which would block the call with a less helpful message.
PLAN_TIMEOUT_SECONDS = 10

CRON_MESSAGE = (
    "BLOCKED: Hermes cron jobs are not used here. Recurring work is a routine in Plan, which "
    "a person sets up on the project's Schedules page; a Hermes job would run the work twice."
)


def approved_commands(run_id: str) -> list[str]:
    if not run_id.isdigit():
        raise ValueError("ITSAPLAN_RUN_ID is not a run id")
    url = f"{os.environ['ITSAPLAN_URL'].rstrip('/')}/agent-runs/{run_id}/approved-commands"
    request = urllib.request.Request(url, headers={"x-api-key": os.environ["ITSAPLAN_API_KEY"]})
    with urllib.request.urlopen(request, timeout=PLAN_TIMEOUT_SECONDS) as response:
        commands = json.load(response)
    if not isinstance(commands, list):
        raise ValueError("Plan answered with an unexpected body")
    return commands


def block_message(tool_name: str, args: dict[str, Any]) -> str | None:
    if tool_name == "terminal":
        text = args.get("command")
        if not isinstance(text, str):
            return None
        hardline, description = detect_hardline_command(text)
        if hardline:
            return (
                f"BLOCKED: {description}. Hermes never runs this command, not even with an "
                "approval, so do not request one."
            )
        dangerous, _, description = detect_dangerous_command(text)
        if not dangerous:
            return None
        subject, reason = "command", f"it is flagged as dangerous: {description}"
    elif tool_name == "execute_code":
        text = args.get("code")
        if not isinstance(text, str):
            return None
        # Hermes' own gate treats every script as one approval, since a script reaches the
        # system without passing the terminal command checks.
        subject, reason = "code", "execute_code runs arbitrary Python; prefer the regular tools"
    else:
        return None
    approved = {command.strip() for command in approved_commands(os.environ["ITSAPLAN_RUN_ID"])}
    if text.strip() in approved:
        return None
    return (
        f"BLOCKED: this {subject} needs a person's approval in Plan ({reason}). If it is "
        "needed, call Plan's request_approval tool with the kind that fits, the action in one "
        f"line and exactly this {subject} in command, then end your run without running it. "
        f"Plan starts a new run with the decision, in which exactly this {subject} may run. "
        "Do not reach the same result another way."
    )


def check_tool_call(tool_name: str = "", args: Any = None, **_: Any) -> dict[str, str] | None:
    if tool_name == "cronjob_manage":
        return {"action": "block", "message": CRON_MESSAGE}
    if not os.environ.get("ITSAPLAN_RUN_ID") or not isinstance(args, dict):
        return None
    try:
        message = block_message(tool_name, args)
    except Exception as exc:  # noqa: BLE001 - Hermes lets the call run when a hook raises
        message = (
            f"BLOCKED: Plan could not confirm an approval for this call ({exc}). Do not run it "
            "or reach the same result another way; end the run and report the problem."
        )
    return {"action": "block", "message": message} if message else None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", check_tool_call)

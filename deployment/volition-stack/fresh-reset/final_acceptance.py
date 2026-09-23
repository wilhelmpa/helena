#!/usr/bin/env python3
import argparse
import base64
import concurrent.futures
import datetime as dt
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.parse
import urllib.request
import uuid

import fresh_reset


CONFIRMATION = "RUN_VOLITION_FRESH_ACCEPTANCE"
API = "http://127.0.0.1:3000"
KEY_FILE = fresh_reset.STACK / ".secrets/itsaplan_home_master_agent_api_key"
HERMES_HOME = fresh_reset.STACK / "data/hermes"
BROWSER_HELPER = Path(__file__).resolve().parent / "browser_acceptance.mjs"
LOCK = fresh_reset.RESET_STATE / "fresh-runtime-acceptance.lock"


class AcceptanceError(RuntimeError):
    pass


def iso_now():
    return fresh_reset.iso(fresh_reset.utc_now())


def run(command, *, input_text=None, capture=True, env=None, timeout=900, check=True):
    return subprocess.run(
        command,
        input=input_text,
        text=True,
        capture_output=capture,
        check=check,
        env={**os.environ, **(env or {})},
        timeout=timeout,
    )


def sql(statement):
    result = run(
        [
            "docker", "exec", "-i", "itsaplan-postgres-1", "sh", "-lc",
            'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq',
        ],
        input_text=statement,
    )
    return result.stdout.strip()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def api(path, *, key, body=None):
    headers = {"x-api-key": key}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode()
    request = urllib.request.Request(API + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None
    except Exception as error:
        raise AcceptanceError(f"Plan runner API failed: {path}") from error


def wait_row(statement, predicate, timeout=600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = sql(statement)
        if predicate(value):
            return value
        time.sleep(1)
    raise AcceptanceError("timed out waiting for fresh-runtime state")


def signed_cookie(token):
    secret = run(
        ["docker", "exec", "itsaplan-api-1", "printenv", "BETTER_AUTH_SECRET"]
    ).stdout.strip()
    if not secret:
        raise AcceptanceError("Plan auth secret is unavailable inside the API container")
    signature = base64.b64encode(hmac.new(secret.encode(), token.encode(), hashlib.sha256).digest()).decode()
    value = urllib.parse.quote(f"{token}.{signature}", safe="")
    return f"__Secure-better-auth.session_token={value}"


def read_stream(project_key, agent_id, message_id, cookie):
    url = f"{API}/projects/{urllib.parse.quote(project_key)}/ai-agents/{agent_id}/chat/{message_id}/stream"
    request = urllib.request.Request(url, headers={"Cookie": cookie, "Accept": "text/event-stream"})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            if response.status != 200 or "text/event-stream" not in response.headers.get("content-type", ""):
                raise AcceptanceError("Plan AG-UI endpoint did not return an event stream")
            text = response.read().decode("utf-8", "replace")
    except Exception as error:
        if isinstance(error, AcceptanceError):
            raise
        raise AcceptanceError("Plan AG-UI stream failed") from error
    frames = [part for part in text.split("\n\n") if part.startswith("data:")]
    if len(frames) < 2 or "RUN_FINISHED" not in frames[-1]:
        raise AcceptanceError("Plan AG-UI stream lacked a successful terminal frame")
    return len(frames)


def inventory():
    statement = """
SELECT json_build_object(
  'projectId', p.id, 'projectKey', p.key, 'agentId', a.id, 'ownerUserId', u.id
)::text
FROM project p
JOIN project_member pm ON pm.project_id=p.id
JOIN ai_agent a ON a.user_id=pm.user_id AND a.kind='external' AND a.username='hermes'
CROSS JOIN LATERAL (
  SELECT person.id FROM "user" person
  LEFT JOIN ai_agent owned_agent ON owned_agent.user_id=person.id
  WHERE owned_agent.id IS NULL AND person.active=true
  ORDER BY person.created_at LIMIT 1
) u
WHERE p.key='HOME';
"""
    lines = [line for line in sql(statement).splitlines() if line]
    if len(lines) != 1:
        raise AcceptanceError("fresh HOME/Hermes/owner inventory is not unique")
    return json.loads(lines[0])


def insert_run(agent_id, project_id, token):
    return int(sql(
        "INSERT INTO agent_run (agent_id,project_id,trigger,prompt,status,next_attempt_at) VALUES "
        f"({agent_id},{project_id},'manual',{literal('Fresh acceptance ' + token)},'pending',now()) RETURNING id;"
    ))


def insert_chat(agent_id, owner_id, model, reasoning, token, thread_id=None):
    if thread_id is None:
        thread_id = f"chat:{agent_id}:fresh-acceptance-{token}"
        sql(
            "INSERT INTO agent_chat_thread (id,agent_id,user_id,title,model,thinking_level) VALUES "
            f"({literal(thread_id)},{agent_id},{literal(owner_id)},'Fresh acceptance',{literal(model)},{literal(reasoning)});"
        )
    prompt = f"Reply exactly FRESH_ACCEPTANCE_{token[-8:]} and do not use tools."
    sql(
        "INSERT INTO agent_chat_message (thread_id,agent_id,role,content,status) VALUES "
        f"({literal(thread_id)},{agent_id},'user',{literal(prompt)},'success');"
    )
    message_id = int(sql(
        "INSERT INTO agent_chat_message (thread_id,agent_id,role,content,status,next_attempt_at) VALUES "
        f"({literal(thread_id)},{agent_id},'assistant','','pending',now()) RETURNING id;"
    ))
    return thread_id, message_id


def inspect_and_requeue_chat(key, message_id, expected_session):
    status, payload = api("/agent-chats/claim", key=key)
    message = (payload or {}).get("message")
    if status != 200 or not message or message.get("id") != message_id:
        raise AcceptanceError("Plan chat claim did not return the acceptance message")
    if message.get("model") != "gpt-4.1" or message.get("thinkingLevel") != "medium":
        raise AcceptanceError("Plan chat claim lost model or reasoning")
    if message.get("sessionId") != expected_session:
        raise AcceptanceError("Plan chat claim did not resume the expected Hermes session")
    sql(
        "UPDATE agent_chat_message SET status='pending',attempts=0,next_attempt_at=now(),started_at=NULL "
        f"WHERE id={message_id};"
    )


def run_chat_turn(meta, key, cookie, token, thread_id=None, expected_session=None):
    thread_id, message_id = insert_chat(
        meta["agentId"], meta["ownerUserId"], "gpt-4.1", "medium", token, thread_id
    )
    fresh_reset.service("stop", "volition-hermes-runner.service", check=False)
    inspect_and_requeue_chat(key, message_id, expected_session)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        stream = pool.submit(
            read_stream, meta["projectKey"], meta["agentId"], message_id, cookie
        )
        fresh_reset.service("start", "volition-hermes-runner.service")
        fresh_reset.wait_active("volition-hermes-runner.service")
        state = wait_row(
            f"SELECT status FROM agent_chat_message WHERE id={message_id};",
            lambda value: value in {"success", "failed"},
        )
        if state != "success":
            raise AcceptanceError("Hermes chat acceptance failed")
        frame_count = stream.result(timeout=620)
    session_id = sql(f"SELECT coalesce(cli_session_id,'') FROM agent_chat_thread WHERE id={literal(thread_id)};")
    if not session_id:
        raise AcceptanceError("Hermes did not bind a session to the Plan thread")
    return thread_id, message_id, session_id, frame_count


def browser_acceptance():
    seed = json.loads(run(["node", str(BROWSER_HELPER), "seed"]).stdout)
    cookie_value = seed.pop("cookieValue")
    restarted_at = iso_now()
    fresh_reset.service("stop", "volition-standalone-browser.target")
    fresh_reset.service("start", "volition-standalone-browser.target")
    run([str(fresh_reset.STACK / "browser/bin/probe")], timeout=60)
    verified = json.loads(
        run(
            ["node", str(BROWSER_HELPER), "verify"],
            env={"VOLITION_ACCEPTANCE_COOKIE": cookie_value},
        ).stdout
    )
    marker_hash = hashlib.sha256(cookie_value.encode()).hexdigest()
    return {
        "restartedAt": restarted_at,
        "profileVerifiedAt": verified["verifiedAt"],
        "profileMarkerSha256": marker_hash,
        "cdpEndpoint": "http://127.0.0.1:9223",
        "noVncWebSocketEndpoint": "ws://127.0.0.1:6081/websockify",
        "noVncVerifiedAt": verified["noVncVerifiedAt"],
    }


def execute():
    if fresh_reset.COMPLETE_MARKER.exists():
        raise AcceptanceError("fresh reset is already complete")
    prepared = fresh_reset.private_json(fresh_reset.PREPARED_MARKER)
    snapshot_id = fresh_reset.validate_prepared_marker(prepared)
    prepared_hash = fresh_reset.file_sha256(fresh_reset.PREPARED_MARKER)
    if fresh_reset.FINAL_ACCEPTANCE_MARKER.exists():
        existing = fresh_reset.private_json(fresh_reset.FINAL_ACCEPTANCE_MARKER)
        fresh_reset.validate_final_acceptance_marker(existing, prepared, prepared_hash)
        fresh_reset.verify_final_live_state(existing["runtimeIdentities"])
        return fresh_reset.FINAL_ACCEPTANCE_MARKER
    fresh_reset.verify_final_live_state()
    if not KEY_FILE.is_file():
        raise AcceptanceError("fresh HOME Hermes runner key is unavailable")
    key = KEY_FILE.read_text().strip()
    if not key:
        raise AcceptanceError("fresh HOME Hermes runner key is empty")
    meta = inventory()
    if sql(f"SELECT count(*) FROM agent_run WHERE agent_id={meta['agentId']} AND status='pending';") != "0":
        raise AcceptanceError("Hermes has pre-existing pending runs")
    if sql(f"SELECT count(*) FROM agent_chat_message WHERE agent_id={meta['agentId']} AND status IN ('pending','streaming');") != "0":
        raise AcceptanceError("Hermes has pre-existing live chats")
    if sql(f"SELECT count(*) FROM agent_chat_thread WHERE agent_id={meta['agentId']};") != "0":
        raise AcceptanceError("Hermes has pre-existing chat threads; acceptance needs the fresh maintenance window")
    catalog = sql(
        "SELECT count(*) FROM agent_chat_catalog c, jsonb_array_elements(c.models) model "
        f"WHERE c.agent_id={meta['agentId']} AND model->>'id'='gpt-4.1' "
        "AND model->'thinkingLevels' ? 'medium';"
    )
    if catalog != "1":
        raise AcceptanceError("Hermes model/reasoning catalog is not ready")
    sessions = HERMES_HOME / "sessions"
    if not sessions.is_dir() or any(sessions.iterdir()):
        raise AcceptanceError("Hermes session store is not blank before fresh acceptance")

    token = uuid.uuid4().hex
    session_id = "fresh-acceptance-" + token
    session_token = secrets.token_urlsafe(32)
    run_id = None
    thread_id = None
    first_session = None
    marker_file = HERMES_HOME / "runtime/fresh-acceptance-profile-marker"
    started_at = iso_now()
    marker = None
    cleanup_errors = []
    try:
        sql(
            "INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES "
            f"({literal(session_id)},now()+interval '1 hour',{literal(session_token)},now(),now(),{literal(meta['ownerUserId'])});"
        )
        cookie = signed_cookie(session_token)

        fresh_reset.service("stop", "volition-hermes-runner.service", check=False)
        run_id = insert_run(meta["agentId"], meta["projectId"], token)
        claimed_at = iso_now()
        status, payload = api("/agent-runs/claim", key=key)
        if status != 200 or (payload or {}).get("run", {}).get("id") != run_id:
            raise AcceptanceError("Plan run claim acceptance failed")
        heartbeat_at = iso_now()
        if api(f"/agent-runs/{run_id}/heartbeat", key=key)[0] != 204:
            raise AcceptanceError("Plan run heartbeat acceptance failed")
        result_at = iso_now()
        if api(f"/agent-runs/{run_id}/result", key=key, body={"status": "success", "output": "fresh acceptance"})[0] != 204:
            raise AcceptanceError("Plan run result acceptance failed")
        if sql(f"SELECT status FROM agent_run WHERE id={run_id};") != "success":
            raise AcceptanceError("Plan did not persist the successful run result")

        profile_value = secrets.token_bytes(32)
        marker_file.write_bytes(profile_value)
        os.chmod(marker_file, 0o600)
        profile_hash = hashlib.sha256(profile_value).hexdigest()
        thread_id, first_message, first_session, first_frames = run_chat_turn(
            meta, key, cookie, token
        )
        hermes_active_at = iso_now()

        fresh_reset.service("stop", "volition-hermes-runner.service")
        if not marker_file.is_file() or hashlib.sha256(marker_file.read_bytes()).hexdigest() != profile_hash:
            raise AcceptanceError("Hermes profile marker did not survive runner restart")
        profile_verified_at = iso_now()
        thread_id, second_message, resumed_session, second_frames = run_chat_turn(
            meta, key, cookie, token + "2", thread_id, first_session
        )
        if resumed_session != first_session:
            raise AcceptanceError("Hermes session changed during Plan thread resume")

        browser = browser_acceptance()
        browser["blankVerifiedAt"] = prepared["browserBlankVerifiedAt"]
        completed_at = iso_now()
        identities = fresh_reset.current_runtime_identities()
        marker = {
            "schemaVersion": 1,
            "resetVersion": fresh_reset.RESET_VERSION,
            "scriptVersion": fresh_reset.SCRIPT_VERSION,
            "backupSnapshotId": snapshot_id,
            "preparedMarkerSha256": prepared_hash,
            "startedAt": started_at,
            "completedAt": completed_at,
            "runtimeIdentities": identities,
            **fresh_reset.FINAL_ACCEPTANCE_REQUIREMENTS,
            "evidence": {
                "planRun": {
                    "runId": run_id, "claimedAt": claimed_at, "heartbeatAt": heartbeat_at,
                    "resultAt": result_at, "resultStatus": "success",
                },
                "agUi": {
                    "threadId": thread_id, "firstMessageId": first_message,
                    "secondMessageId": second_message, "sessionId": first_session,
                    "resumedSessionId": resumed_session, "streamStartedAt": started_at,
                    "streamCompletedAt": completed_at, "terminalEventType": "RUN_FINISHED",
                    "streamFrameCount": first_frames + second_frames,
                    "model": "gpt-4.1", "reasoning": "medium",
                },
                "hermes": {
                    "activeAt": hermes_active_at,
                    "profileVerifiedAfterRestartAt": profile_verified_at,
                    "profileMarkerSha256": profile_hash,
                },
                "browser": browser,
            },
        }
        fresh_reset.validate_final_acceptance_marker(marker, prepared, prepared_hash)
    finally:
        fresh_reset.service("stop", "volition-hermes-runner.service", check=False)
        concurrent_chat = False
        if thread_id:
            try:
                concurrent_chat = sql(
                    "SELECT count(*) FROM agent_chat_thread WHERE agent_id="
                    f"{meta['agentId']} AND id<>{literal(thread_id)};"
                ) != "0"
            except Exception as error:
                concurrent_chat = True
                cleanup_errors.append(type(error).__name__)
        cleanup_steps = []
        if thread_id:
            cleanup_steps.append(lambda: sql(f"DELETE FROM agent_chat_thread WHERE id={literal(thread_id)};"))
        if run_id:
            cleanup_steps.append(lambda: sql(f"DELETE FROM agent_run WHERE id={run_id};"))
        cleanup_steps += [
            lambda: sql(f"DELETE FROM session WHERE id={literal(session_id)};"),
            lambda: marker_file.unlink(missing_ok=True),
        ]
        if first_session:
            cleanup_steps.append(
                lambda: run(
                    ["/home/pw/.local/bin/hermes", "sessions", "delete", "--yes", first_session],
                    env={"HERMES_HOME": str(HERMES_HOME)},
                    timeout=120,
                )
            )
        if concurrent_chat:
            cleanup_errors.append("ConcurrentChatDetected")
        for step in cleanup_steps:
            try:
                step()
            except Exception as error:
                cleanup_errors.append(type(error).__name__)
        fresh_reset.service("start", "volition-hermes-runner.service", check=False)
    if cleanup_errors:
        raise AcceptanceError("fresh acceptance cleanup failed")
    if marker is None:
        raise AcceptanceError("fresh acceptance produced no evidence")
    if thread_id and sql(f"SELECT count(*) FROM agent_chat_thread WHERE id={literal(thread_id)};") != "0":
        raise AcceptanceError("fresh acceptance chat cleanup was not verified")
    if run_id and sql(f"SELECT count(*) FROM agent_run WHERE id={run_id};") != "0":
        raise AcceptanceError("fresh acceptance run cleanup was not verified")
    if sql(f"SELECT count(*) FROM session WHERE id={literal(session_id)};") != "0":
        raise AcceptanceError("fresh acceptance session cleanup was not verified")
    if first_session:
        remaining = run(
            ["/home/pw/.local/bin/hermes", "sessions", "list", "--limit", "100"],
            env={"HERMES_HOME": str(HERMES_HOME)},
            timeout=120,
        ).stdout
        if first_session in remaining:
            raise AcceptanceError("fresh acceptance Hermes session cleanup was not verified")
    fresh_reset.wait_active("volition-hermes-runner.service")
    fresh_reset.validate_final_acceptance_marker(marker, prepared, prepared_hash)
    fresh_reset.atomic_json(fresh_reset.FINAL_ACCEPTANCE_MARKER, marker)
    return fresh_reset.FINAL_ACCEPTANCE_MARKER


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps({
            "mode": "dry-run",
            "prepared": fresh_reset.PREPARED_MARKER.exists(),
            "acceptanceMarker": str(fresh_reset.FINAL_ACCEPTANCE_MARKER),
            "tests": sorted(fresh_reset.FINAL_ACCEPTANCE_REQUIREMENTS),
            "secretValuesExposed": False,
        }))
        return 0
    if args.confirm != CONFIRMATION:
        raise AcceptanceError("acceptance execution requires the exact confirmation string")
    fresh_reset.RESET_STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        os.chmod(LOCK, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marker = execute()
    print(json.dumps({"ok": True, "marker": str(marker), "secretValuesExposed": False}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AcceptanceError, fresh_reset.ResetError, subprocess.SubprocessError, OSError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=os.sys.stderr)
        raise SystemExit(1)

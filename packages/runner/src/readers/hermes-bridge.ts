// Run with Hermes' own interpreter (readers/hermes.ts); kept as a string so the runner
// bundle stays one file.
export const HERMES_BRIDGE = `"""Reads a Hermes profile through Hermes' own state module for the runner (readers/hermes.ts).

One request as JSON on stdin, one JSON answer on stdout. HERMES_HOME names the profile. The
store is opened read-only, the way Hermes' dashboard reads it; nothing is written. Text that
leaves here goes through Hermes' own secret redaction.
"""

import json
import os
import sys
from pathlib import Path


def redact(value):
    from agent.redact import redact_sensitive_text

    if isinstance(value, str):
        return redact_sensitive_text(value, force=True)
    return value


def session_row(row):
    return {
        "id": row.get("id"),
        "title": redact(row.get("title")),
        "preview": redact(row.get("preview")),
        "source": row.get("source"),
        "model": row.get("model"),
        "startedAt": row.get("started_at"),
        "endedAt": row.get("ended_at"),
        "lastActiveAt": row.get("last_active") or row.get("started_at"),
        "endReason": row.get("end_reason"),
        "messageCount": row.get("message_count") or 0,
        "toolCallCount": row.get("tool_call_count") or 0,
        "inputTokens": row.get("input_tokens") or 0,
        "outputTokens": row.get("output_tokens") or 0,
        "cacheReadTokens": row.get("cache_read_tokens") or 0,
        "cacheWriteTokens": row.get("cache_write_tokens") or 0,
        "reasoningTokens": row.get("reasoning_tokens") or 0,
        "estimatedCostUsd": row.get("estimated_cost_usd"),
        "parentSessionId": row.get("parent_session_id"),
        "archived": bool(row.get("archived")),
    }


def open_db():
    from hermes_state import SessionDB

    path = Path(os.environ["HERMES_HOME"]) / "state.db"
    if not path.exists() or path.stat().st_size == 0:
        return None
    return SessionDB(db_path=path, read_only=True)


def list_sessions(db, request):
    limit = max(1, min(int(request.get("limit") or 25), 100))
    offset = max(0, int(request.get("offset") or 0))
    rows = db.list_sessions_rich(
        limit=limit, offset=offset, order_by_last_active=True, compact_rows=True,
        include_archived=True, include_pinned=True)
    total = db.session_count(exclude_children=True, include_archived=True)
    return {"sessions": [session_row(row) for row in rows], "total": total}


def search(db, request):
    query = (request.get("query") or "").strip()
    limit = max(1, min(int(request.get("limit") or 20), 50))
    if not query:
        return {"hits": []}
    hits = []
    seen = set()
    for row in db.search_sessions_by_id(query, limit=limit, include_archived=True):
        seen.add(row.get("id"))
        hits.append({"sessionId": row.get("id"), "role": None, "snippet": redact(row.get("preview") or ""),
                     "session": session_row(row)})
    # Prefix wildcards so a partial word matches, as the dashboard's search does.
    words = [w if w.startswith('"') or w.endswith("*") else w + "*" for w in query.split()]
    for match in db.search_messages(query=" ".join(words), limit=limit * 3,
                                    fields=("session_id", "role", "snippet")):
        if len(hits) >= limit:
            break
        sid = match.get("session_id")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        row = db.get_session_rich_row(sid) if hasattr(db, "get_session_rich_row") else None
        hits.append({"sessionId": sid, "role": match.get("role"), "snippet": redact(match.get("snippet") or ""),
                     "session": session_row(row) if row else None})
    return {"hits": hits}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    op = request.get("op")
    db = open_db()
    try:
        if op == "list":
            result = list_sessions(db, request) if db else {"sessions": [], "total": 0}
        elif op == "search":
            result = search(db, request) if db else {"hits": []}
        else:
            raise ValueError("unknown operation")
    finally:
        if db:
            db.close()
    sys.stdout.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - the runner reports the failure, not a trace
        sys.stdout.write(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"[:300]}))
`;

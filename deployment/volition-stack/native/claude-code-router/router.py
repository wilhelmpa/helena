#!/usr/bin/env python3
"""/router for the owner's Claude Code: switch Helena's model router on or off, see what it
decided, try it on a prompt (docs/helena-decisions/decisions.md §4.3).

  router.py on | off | status | test <prompt> | log [n]
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import route  # noqa: E402  -- the hook next to this file

DIR = route.DIR
FLAG = os.path.join(DIR, "enabled")


def entries() -> list[dict]:
    try:
        with open(os.path.join(DIR, "log.jsonl"), encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]
    except (OSError, ValueError):
        return []


def status() -> None:
    cfg = route.config()
    print(f"Helena-Modellwahl: {'AN' if os.path.exists(FLAG) else 'AUS'}")
    print(f"Helena: {cfg['helenaUrl']}  ·  Sitzungsmodell (Standard): {cfg['sessionModel']}")
    print(f"API-Schlüssel: {'vorhanden' if route.read_key() else 'fehlt — ' + os.path.join(DIR, 'key')}")
    log = entries()
    decided = [e for e in log if e.get("decision") in ("delegate", "handle")]
    if not log:
        print("Noch keine Entscheidungen.")
        return
    tiers: dict[str, int] = {}
    for entry in decided:
        tiers[str(entry.get("tier"))] = tiers.get(str(entry.get("tier")), 0) + 1
    delegated = sum(1 for e in decided if e.get("decision") == "delegate")
    ms = [int(e.get("ms", 0)) for e in log]
    print(
        f"Entscheidungen: {len(decided)} (abgegeben: {delegated}, ohne Antwort: {len(log) - len(decided)})"
        f"  ·  Stufen: {', '.join(f'{k} {v}' for k, v in sorted(tiers.items()))}"
        f"  ·  Mittel: {sum(ms) // max(1, len(ms))} ms"
    )


def show_log(n: int) -> None:
    for entry in entries()[-n:]:
        print(
            f"{entry.get('ts', '')}  {str(entry.get('decision', '')).ljust(8)} "
            f"{str(entry.get('tier') or '–').ljust(9)} conf={entry.get('confidence')} "
            f"ctx={entry.get('needsContext')} {entry.get('ms', '')}ms"
            + (f"  {entry['prompt']}" if entry.get("prompt") else "")
        )


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "status"
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    if command == "on":
        open(FLAG, "a").close()
        print("Helena-Modellwahl ist AN. Vor jedem Prompt geht nur der Prompt-Text an Helena "
              "(dort an das eingestellte Entscheidungsmodell).")
    elif command == "off":
        if os.path.exists(FLAG):
            os.remove(FLAG)
        print("Helena-Modellwahl ist AUS. Nichts verlässt diese Sitzung.")
    elif command == "status":
        status()
    elif command == "log":
        show_log(int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 20)
    elif command == "test":
        prompt = " ".join(argv[1:]).strip()
        if not prompt:
            print("Aufruf: /router test <Prompt>")
            return 1
        note = route.route({"prompt": prompt}, force=True)
        print(note or "Keine Entscheidung (zu kurz, Slash-Befehl, kein Schlüssel oder Helena antwortet nicht).")
    else:
        print("Aufruf: /router on | off | status | test <Prompt> | log [n]")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

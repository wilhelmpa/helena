---
name: router
description: Helena's model router for this Claude Code — switch it on or off, see its decisions, try it on a prompt. Use for "/router on", "/router off", "/router status", "/router test <prompt>", "/router log".
argument-hint: on | off | status | test <prompt> | log [n]
disable-model-invocation: true
allowed-tools: Bash(python3 ~/.claude/helena-router/router.py *)
---

!`python3 ~/.claude/helena-router/router.py $ARGUMENTS || true`

Report the output above to the user in their language, briefly and without commentary. If the
router is on and the user is about to paste secrets or customer data, remind them once that
the prompt text goes to Helena's decision model (which may be a cloud service, as configured
in Helena → Einstellungen → Entscheidungen).

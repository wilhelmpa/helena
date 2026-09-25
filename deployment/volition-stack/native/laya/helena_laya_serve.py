"""Helena's local decision server: Laya, browser-tuned, over the System One wire protocol.

docs/helena-decisions/browser-task.md §2.3 and §3.8. The browser gateway's fast path
(browser_task) asks "which operation, which element" in TypeSafe's `/v1/systemone` format; this
answers it with the open Laya model on this machine, so page content never leaves it.

- Model: the browser-tuned checkpoint cklxx/laya-browser (Apache-2.0), subfolder v10s (322M,
  mmBERT-base, "v3" request format), loaded with `laya.load` (Laya, Apache-2.0, © Convai
  Innovations) from a local directory the installer downloaded at a pinned revision.
- The request shaping and the coarse-to-fine split of wide choices follow the checkpoint's own
  server (cklxx/laya-browser code/apps/systemone_server.py, Apache-2.0) and laya-browser-agent's
  decider (Apache-2.0, © Chenney Zhuang): element descriptions are compacted, choices wider than
  MAXOPT options are answered in chunks and the chunk winners compete in a second pass,
  p(option) = p_final(winner of its chunk) * p_chunk(option).
- What the upstream servers lack and Helena needs: a constant-time Bearer check against the key
  file the installer wrote, no CORS header (the project browsers run on this machine and must not
  be able to call it), body and question caps, one inference at a time, 127.0.0.1 by default.

Environment (set by helena-laya.service):
  HELENA_LAYA_HOST      bind address                    127.0.0.1
  HELENA_LAYA_PORT      port                            8791
  HELENA_LAYA_MODEL_DIR checkpoint repo directory       /var/lib/helena-laya/models/laya-browser
  HELENA_LAYA_SUBFOLDER checkpoint inside it            v10s
  HELENA_LAYA_KEY_FILE  Bearer key (required)           /etc/helena/laya.key
  HELENA_LAYA_THREADS   torch intra-op threads          8
  HELENA_LAYA_DEVICE    cpu, or cuda: the GPU through   cpu
                        ROCm (install.sh --rocm); falls back to the CPU when PyTorch sees no GPU
  HELENA_LAYA_MAXOPT    widest choice asked at once     12
"""
from __future__ import annotations

import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Tuple

MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_QUESTIONS = 64
MAX_STATE_CHARS = 60_000


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


HOST = _env("HELENA_LAYA_HOST", "127.0.0.1")
PORT = int(_env("HELENA_LAYA_PORT", "8791"))
MODEL_DIR = _env("HELENA_LAYA_MODEL_DIR", "/var/lib/helena-laya/models/laya-browser")
SUBFOLDER = _env("HELENA_LAYA_SUBFOLDER", "v10s")
KEY_FILE = _env("HELENA_LAYA_KEY_FILE", "/etc/helena/laya.key")
THREADS = int(_env("HELENA_LAYA_THREADS", "8"))
DEVICE = _env("HELENA_LAYA_DEVICE", "cpu")
MAXOPT = max(2, int(_env("HELENA_LAYA_MAXOPT", "12")))
MODEL_NAME = f"laya-browser-{SUBFOLDER}"


def _read_key() -> bytes:
    with open(KEY_FILE, "rb") as handle:
        key = handle.read().strip()
    if len(key) < 24:
        raise SystemExit(f"{KEY_FILE}: the key is too short")
    return b"Bearer " + key


class Model:
    """The loaded checkpoint and one lock: a CPU forward pass at a time is what this machine wants."""

    def __init__(self) -> None:
        import torch
        import laya

        torch.set_num_threads(max(1, THREADS))
        started = time.time()
        # ROCm's PyTorch calls the GPU "cuda". Without one (no /dev/kfd, CPU wheel) the CPU answers.
        self.device = DEVICE if DEVICE == "cpu" or torch.cuda.is_available() else "cpu"
        if self.device != DEVICE:
            print(f"[helena-laya] {DEVICE} requested, PyTorch sees no GPU: using the CPU", flush=True)
        self.agent = laya.load(MODEL_DIR, subfolder=SUBFOLDER, device=self.device)
        cfg = self.agent.cfg
        if cfg.get("head_max_len_train"):
            cfg["head_max_len"] = cfg["head_max_len_train"]
        self.fmt = cfg.get("laya_fmt", "v1")
        self.lock = threading.Lock()
        print(f"[helena-laya] {MODEL_NAME} ({self.fmt}) loaded on {self.device} in {time.time() - started:.1f}s", flush=True)

    def compact(self, value: Any) -> Any:
        # jev-ultrafast element criteria ({'element': '[3] Search', 'role': 'button', ...}) as one
        # short string, so more options fit the head's token budget (the checkpoint's own server).
        if isinstance(value, dict) and "element" in value:
            text = str(value["element"])[: 50 if self.fmt == "v3" else 10000]
            if value.get("role"):
                text += f" ({value['role']})"
            if value.get("current_value"):
                text += f" = {str(value['current_value'])[:30]!r}"
            for key in ("checked", "selected", "expanded"):
                if key in value:
                    text += f" {key}={value[key]}"
            return text
        return value

    def shape_state(self, state: Any) -> Any:
        if isinstance(state, dict) and isinstance(state.get("page"), dict) and isinstance(state["page"].get("text"), str):
            if self.fmt in ("v2", "v3"):
                limit = 1500 if self.fmt == "v2" else 1200
                return {
                    "page": {**state["page"], "text": state["page"]["text"][:limit]},
                    "recent_actions": state.get("recent_actions", []),
                }
            return {**state, "page": {**state["page"], "text": state["page"]["text"][:6000]}}
        return state

    def _predict(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        result = self.agent.predict(state, questions)
        if not isinstance(result, dict) or not isinstance(result.get("answers"), dict):
            raise ValueError("the model returned no answers")
        return result

    def answer(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        state = self.shape_state(state)
        prepared: Dict[str, Any] = {}
        plan: Dict[str, Tuple[Dict[str, Any], List[List[str]]]] = {}
        for qid, question in questions.items():
            question = dict(question)
            if isinstance(question.get("criteria"), dict):
                question["criteria"] = {k: self.compact(v) for k, v in question["criteria"].items()}
            keys = list(question["criteria"]) if question.get("type") == "choice" and isinstance(question.get("criteria"), dict) else []
            if len(keys) <= MAXOPT:
                prepared[qid] = question
                continue
            n = -(-len(keys) // MAXOPT)
            chunks = [keys[i::n] for i in range(n)]
            plan[qid] = (question, chunks)
            for index, chunk in enumerate(chunks):
                prepared[f"{qid}__chunk{index}"] = {**question, "criteria": {k: question["criteria"][k] for k in chunk}}
        with self.lock:
            first = self._predict(state, prepared)
            answers = dict(first["answers"])
            usage = dict(first.get("usage") or {})
            if plan:
                chunk_answers = {
                    qid: [answers.pop(f"{qid}__chunk{index}") for index in range(len(chunks))]
                    for qid, (_, chunks) in plan.items()
                }
                finals = {
                    qid: {**question, "criteria": {a["choice"]: question["criteria"][a["choice"]] for a in chunk_answers[qid]}}
                    for qid, (question, _) in plan.items()
                }
                second = self._predict(state, finals)
                usage["input_tokens"] = int(usage.get("input_tokens", 0)) + int((second.get("usage") or {}).get("input_tokens", 0))
                for qid, (question, chunks) in plan.items():
                    final = second["answers"][qid]
                    probabilities: Dict[str, float] = {}
                    for winner, chunk in zip(chunk_answers[qid], chunks):
                        weight = float(final["probabilities"].get(winner["choice"], 0.0))
                        for key in chunk:
                            probabilities[key] = weight * float(winner["probabilities"].get(key, 0.0))
                    total = sum(probabilities.values()) or 1.0
                    probabilities = {k: round(v / total, 6) for k, v in probabilities.items()}
                    chosen = max(probabilities, key=probabilities.get)
                    answers[qid] = {
                        "type": "choice",
                        "choice": chosen,
                        "probabilities": probabilities,
                        "confidence": final.get("confidence", probabilities[chosen]),
                    }
        return {
            "model": MODEL_NAME,
            "answers": answers,
            "usage": {"input_tokens": int(usage.get("input_tokens", 0)), "output_tokens": int(usage.get("output_tokens", 0))},
        }


MODEL: Model | None = None
EXPECTED: bytes = b""


class Handler(BaseHTTPRequestHandler):
    server_version = "helena-laya"
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args: Any) -> None:  # the unit's journal gets one line per call below
        pass

    def _send(self, status: int, body: Dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        supplied = (self.headers.get("Authorization") or "").encode("utf-8", "surrogateescape")
        return hmac.compare_digest(supplied, EXPECTED)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/")
        if path == "/health":
            self._send(200, {"status": "ok", "model": MODEL_NAME})
            return
        if not self._authorized():
            self._send(401, {"detail": "invalid or missing bearer token"})
            return
        if path == "/v1/models":
            self._send(200, {"models": [{"name": MODEL_NAME, "description": "Laya, browser-tuned, local", "release_date": None}]})
            return
        self._send(404, {"detail": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/")
        if path != "/v1/systemone":
            self._send(404, {"detail": "not found"})
            return
        if not self._authorized():
            self._send(401, {"detail": "invalid or missing bearer token"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(413, {"detail": "request body too large or missing"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            self._send(400, {"detail": "request body must be valid JSON"})
            return
        questions = body.get("questions") if isinstance(body, dict) else None
        if not isinstance(questions, dict) or not questions:
            self._send(422, {"detail": "request body must be an object with a 'questions' field"})
            return
        if len(questions) > MAX_QUESTIONS or len(json.dumps(body.get("state"))) > MAX_STATE_CHARS:
            self._send(413, {"detail": "too many questions or state too large"})
            return
        started = time.perf_counter()
        try:
            result = MODEL.answer(body.get("state"), questions)  # type: ignore[union-attr]
        except (ValueError, KeyError) as error:
            self._send(422, {"detail": str(error)[:300]})
            return
        except Exception as error:  # noqa: BLE001 -- never leak paths or weights to a client
            print(f"[helena-laya] inference failed: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
            self._send(500, {"detail": "inference failed"})
            return
        ms = (time.perf_counter() - started) * 1000
        options = sum(len(q.get("criteria") or []) for q in questions.values() if isinstance(q, dict))
        print(f"[helena-laya] {len(questions)} q / {options} options / {result['usage']['input_tokens']} tok -> {ms:.0f} ms", flush=True)
        self._send(200, result)


def main() -> None:
    global MODEL, EXPECTED
    EXPECTED = _read_key()
    MODEL = Model()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"[helena-laya] serving /v1/systemone on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

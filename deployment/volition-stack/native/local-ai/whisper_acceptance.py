"""Offline corpus validation and explicit loopback Whisper acceptance.

manifest.json schema: {"schemaVersion": 1, "synthetic": true, "language": "de",
"reviewedBy": "review reference", "fixtures": [{"id": "german-short",
"kind": "speech", "file": "german-short.wav", "sha256": "64 lowercase hex",
"expectedText": "Reviewed German words spoken in this synthetic recording"}]}.
Require >=3 speech, >=1 silence and >=1 noise fixture. No corpus is bundled or
generated here. The operator supplies its independently reviewed manifest hash.
Server identity, binary/model provenance and report ownership belong to the operator.
"""

import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import statistics
import threading
import time
import unicodedata
import wave
from dataclasses import asdict, dataclass


MAX_RESPONSE = 65536
MAX_FILE = 640044
MAX_TOTAL = 4 * 1024 * 1024
REPEATS = 3
SHA256 = re.compile(r"[0-9a-f]{64}")
NAME = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")


class AcceptanceError(ValueError):
    pass


@dataclass(frozen=True)
class Fixture:
    id: str
    kind: str
    filename: str
    sha256: str
    expected_text: str
    wav: bytes
    duration_seconds: float


@dataclass(frozen=True)
class Corpus:
    manifest_sha256: str
    reviewed_by: str
    fixtures: tuple[Fixture, ...]


@dataclass(frozen=True)
class Thresholds:
    max_aggregate_wer: float = 0.10
    max_case_wer: float = 0.20
    max_wer_regression: float = 0.02
    max_p50_ms: float = 2000
    max_p95_ms: float = 4000
    max_latency_ratio: float = 1.25
    max_latency_increase_ms: float = 100
    request_timeout_s: float = 20
    total_timeout_s: float = 180

    def validate(self):
        for key, value in asdict(self).items():
            if type(value) not in (float, int) or not math.isfinite(value) or value < 0:
                raise AcceptanceError(f"Invalid threshold: {key}")
        if (self.max_aggregate_wer > 0.25 or self.max_case_wer > 0.5
                or self.max_wer_regression > 0.1 or self.max_latency_ratio > 2
                or min(self.max_p50_ms, self.max_p95_ms, self.max_latency_ratio) <= 0
                or not 0 < self.request_timeout_s <= 30 or not 0 < self.total_timeout_s <= 300):
            raise AcceptanceError("Threshold exceeds acceptance safety bounds")


@dataclass(frozen=True)
class HttpResult:
    status: int
    body: bytes
    elapsed_ms: float


def normalize_german(text):
    text = unicodedata.normalize("NFC", text).casefold()
    return " ".join(re.findall(r"[^\W_]+", text, re.UNICODE))


def word_errors(expected, actual):
    reference = normalize_german(expected).split()
    hypothesis = normalize_german(actual).split()
    if not reference:
        raise AcceptanceError("Speech reference must contain words")
    row = list(range(len(hypothesis) + 1))
    for index, word in enumerate(reference, 1):
        next_row = [index]
        for column, other in enumerate(hypothesis, 1):
            next_row.append(min(next_row[-1] + 1, row[column] + 1,
                                row[column - 1] + (word != other)))
        row = next_row
    return row[-1], len(reference)


def _directory_fd(directory):
    path = Path(directory).absolute()
    if ".." in path.parts:
        raise AcceptanceError("Corpus path cannot contain parent traversal")
    fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _read_file(directory_fd, filename, limit):
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
            raise AcceptanceError("Fixture must be a bounded regular file")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise AcceptanceError("File exceeds size bound")
    return data


def load_corpus(directory, manifest_sha256):
    if not isinstance(manifest_sha256, str) or not SHA256.fullmatch(manifest_sha256):
        raise AcceptanceError("An independently reviewed manifest SHA256 is required")
    try:
        fd = _directory_fd(directory)
    except OSError as error:
        raise AcceptanceError("Corpus directory must exist without symlinks") from error
    try:
        raw = _read_file(fd, "manifest.json", 32768)
        if hashlib.sha256(raw).hexdigest() != manifest_sha256:
            raise AcceptanceError("Manifest SHA256 mismatch")
        manifest = json.loads(raw)
        if (not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int
                or manifest["schemaVersion"] != 1 or manifest.get("synthetic") is not True
                or manifest.get("language") != "de"
                or not isinstance(manifest.get("reviewedBy"), str)
                or not 1 <= len(manifest["reviewedBy"].strip()) <= 200):
            raise AcceptanceError("Manifest requires synthetic German review provenance")
        entries = manifest.get("fixtures")
        if not isinstance(entries, list) or not 5 <= len(entries) <= 8:
            raise AcceptanceError("Corpus requires 5 to 8 fixtures")
        fixtures, ids, filenames, hashes = [], set(), set(), set()
        total = 0
        for entry in entries:
            if not isinstance(entry, dict):
                raise AcceptanceError("Invalid fixture entry")
            name, kind = entry.get("id"), entry.get("kind")
            filename, digest = entry.get("file"), entry.get("sha256")
            expected = entry.get("expectedText")
            if (not isinstance(name, str) or not NAME.fullmatch(name) or name in ids
                    or kind not in ("speech", "silence", "noise")
                    or not isinstance(filename, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}\.wav", filename)
                    or filename in filenames or not isinstance(digest, str)
                    or not SHA256.fullmatch(digest) or digest in hashes
                    or not isinstance(expected, str) or len(expected) > 1000):
                raise AcceptanceError("Invalid, duplicate or unsafe fixture declaration")
            words = normalize_german(expected).split()
            if (kind == "speech" and not 5 <= len(words) <= 100) or (kind != "speech" and expected != ""):
                raise AcceptanceError("Speech needs a transcript; VAD fixtures need an empty transcript")
            data = _read_file(fd, filename, MAX_FILE)
            if hashlib.sha256(data).hexdigest() != digest:
                raise AcceptanceError(f"Fixture SHA256 mismatch: {name}")
            total += len(data)
            if total > MAX_TOTAL:
                raise AcceptanceError("Corpus exceeds total byte bound")
            with wave.open(io.BytesIO(data), "rb") as audio:
                if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth(), audio.getcomptype()) != (1, 16000, 2, "NONE"):
                    raise AcceptanceError("Only 16 kHz mono PCM16 WAV is accepted")
                frames = audio.getnframes()
                pcm = audio.readframes(frames)
            if not 4000 <= frames <= 320000 or len(pcm) != frames * 2:
                raise AcceptanceError("Fixture is truncated or outside 0.25 to 20 seconds")
            if kind == "silence" and any(pcm):
                raise AcceptanceError("Silence fixture must contain digital silence")
            if kind != "silence" and not any(pcm):
                raise AcceptanceError("Speech/noise fixture cannot be digital silence")
            fixtures.append(Fixture(name, kind, filename, digest, expected, data, frames / 16000))
            ids.add(name)
            filenames.add(filename)
            hashes.add(digest)
        kinds = [fixture.kind for fixture in fixtures]
        if kinds.count("speech") < 3 or "silence" not in kinds or "noise" not in kinds:
            raise AcceptanceError("Corpus requires three speech fixtures, silence and noise")
        return Corpus(manifest_sha256, manifest["reviewedBy"], tuple(fixtures))
    except (OSError, wave.Error, EOFError, json.JSONDecodeError, UnicodeError, RecursionError) as error:
        raise AcceptanceError("Cannot load verified WAV corpus") from error
    finally:
        os.close(fd)


def _port(port):
    if type(port) is not int or not 1024 <= port <= 65535:
        raise AcceptanceError("An explicit unprivileged loopback port is required")


def http_request(port, method, path, body, headers, timeout_s):
    _port(port)
    if (method, path) not in (("GET", "/v1/health"), ("POST", "/v1/audio/transcriptions")):
        raise AcceptanceError("Unapproved Whisper endpoint")
    if type(timeout_s) not in (int, float) or not 0 < timeout_s <= 30 or len(body) > MAX_FILE + 4096:
        raise AcceptanceError("Request exceeds time or size bound")
    started = time.monotonic()
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout_s)
    timer = None
    try:
        connection.connect()
        connection_socket = connection.sock

        def interrupt():
            try:
                connection_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        remaining = timeout_s - (time.monotonic() - started)
        if remaining <= 0:
            raise AcceptanceError("Request deadline exceeded")
        timer = threading.Timer(remaining, interrupt)
        timer.daemon = True
        timer.start()
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        length = response.getheader("Content-Length")
        if length is not None and (not length.isdigit() or int(length) > MAX_RESPONSE):
            raise AcceptanceError("Response exceeds size bound")
        data = response.read(MAX_RESPONSE + 1)
        elapsed = (time.monotonic() - started) * 1000
        if elapsed >= timeout_s * 1000 or len(data) > MAX_RESPONSE:
            raise AcceptanceError("Response exceeds time or size bound")
        return HttpResult(response.status, data, elapsed)
    except (OSError, http.client.HTTPException) as error:
        raise AcceptanceError("Loopback Whisper request failed") from error
    finally:
        if timer:
            timer.cancel()
        connection.close()


def _multipart(data):
    boundary = "helena-whisper-acceptance-" + hashlib.sha256(data).hexdigest()
    parts = []
    for name, value in (("language", "de"), ("response_format", "json"), ("temperature", "0")):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode())
    parts.extend((data, f"\r\n--{boundary}--\r\n".encode()))
    return b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"}


def run_server(port, corpus, *, thresholds=Thresholds(), request=None):
    """Run only after operator authorization; no server/model starts are performed."""
    _port(port)
    thresholds.validate()
    if not isinstance(corpus, Corpus):
        raise AcceptanceError("load_corpus must succeed before acceptance")
    request = request or http_request
    report = {"schemaVersion": 1, "port": port, "manifestSha256": corpus.manifest_sha256,
              "reviewedBy": corpus.reviewed_by, "thresholds": asdict(thresholds),
              "fixtures": [{"id": f.id, "kind": f.kind, "sha256": f.sha256,
                            "expectedText": f.expected_text} for f in corpus.fixtures],
              "samples": [], "health": [], "malformed": {}, "errors": []}
    deadline = time.monotonic() + thresholds.total_timeout_s

    def send(method, path, body=b"", headers=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AcceptanceError("Acceptance total deadline exceeded")
        result = request(port, method, path, body, headers or {}, min(remaining, thresholds.request_timeout_s))
        if (not isinstance(result, HttpResult) or type(result.status) is not int
                or not isinstance(result.body, bytes) or len(result.body) > MAX_RESPONSE
                or type(result.elapsed_ms) not in (float, int)
                or not math.isfinite(result.elapsed_ms) or result.elapsed_ms < 0
                or result.elapsed_ms >= thresholds.request_timeout_s * 1000
                or time.monotonic() >= deadline):
            raise AcceptanceError("Invalid or late acceptance response")
        return result

    def health():
        result = send("GET", "/v1/health")
        payload = json.loads(result.body)
        passed = result.status == 200 and isinstance(payload, dict) and payload.get("status") == "ok"
        report["health"].append({"status": result.status, "passed": passed})
        if not passed:
            raise AcceptanceError("Whisper health check failed")

    def transcribe(fixture, iteration):
        body, headers = _multipart(fixture.wav)
        result = send("POST", "/v1/audio/transcriptions", body, headers)
        payload = json.loads(result.body)
        if result.status != 200 or not isinstance(payload, dict) or not isinstance(payload.get("text"), str) or len(payload["text"]) > 4000:
            raise AcceptanceError("Invalid transcription response")
        report["samples"].append({"id": fixture.id, "iteration": iteration,
                                  "text": payload["text"], "latencyMs": result.elapsed_ms})

    try:
        health()
        for iteration in range(REPEATS):
            for fixture in corpus.fixtures:
                if fixture.kind == "speech" or iteration == 0:
                    transcribe(fixture, iteration)
        body, headers = _multipart(b"This is an intentionally malformed synthetic WAV.")
        result = send("POST", "/v1/audio/transcriptions", body, headers)
        report["malformed"] = {"status": result.status, "recoveryPassed": False}
        if result.status not in (400, 422):
            raise AcceptanceError("Malformed audio was not rejected with 400/422")
        health()
        transcribe(next(f for f in corpus.fixtures if f.kind == "speech"), "recovery")
        health()
    except (ValueError, UnicodeError, OSError, RecursionError) as error:
        report["errors"].append(str(error)[:200])
    report.update(_score(report, thresholds))
    return report


def _score(report, thresholds):
    errors = report.get("errors")
    if not isinstance(errors, list) or not all(isinstance(error, str) for error in errors):
        errors = ["Invalid acceptance errors"]
    errors = list(errors)
    samples = report.get("samples", [])
    fixtures = report.get("fixtures", [])
    vad, repeat = [], []
    edits, words, latencies = 0, 0, []
    try:
        _port(report.get("port"))
        if (type(report.get("schemaVersion")) is not int or report["schemaVersion"] != 1
                or not isinstance(report.get("reviewedBy"), str) or not report["reviewedBy"].strip()
                or not SHA256.fullmatch(report.get("manifestSha256", ""))
                or not 5 <= len(fixtures) <= 8 or len({f["id"] for f in fixtures}) != len(fixtures)
                or len({f["sha256"] for f in fixtures}) != len(fixtures)
                or sum(f["kind"] == "speech" for f in fixtures) < 3
                or {"speech", "silence", "noise"} != {f["kind"] for f in fixtures}):
            raise AcceptanceError("Incomplete corpus evidence")
        for fixture in fixtures:
            if (not NAME.fullmatch(fixture["id"]) or not SHA256.fullmatch(fixture["sha256"])
                    or not isinstance(fixture["expectedText"], str) or len(fixture["expectedText"]) > 1000
                    or (fixture["kind"] != "speech" and fixture["expectedText"] != "")
                    or (fixture["kind"] == "speech" and not 5 <= len(normalize_german(fixture["expectedText"]).split()) <= 100)):
                raise AcceptanceError("Invalid fixture evidence")
        speech = [f for f in fixtures if f["kind"] == "speech"]
        expected = {(f["id"], i) for f in fixtures for i in (range(REPEATS) if f["kind"] == "speech" else [0])}
        expected.add((speech[0]["id"], "recovery"))
        if len(samples) != len(expected) or {(s["id"], s["iteration"]) for s in samples} != expected:
            raise AcceptanceError("Incomplete transcription evidence")
        for sample in samples:
            latency = sample["latencyMs"]
            if (type(latency) not in (int, float) or not math.isfinite(latency) or latency < 0
                    or latency >= thresholds.request_timeout_s * 1000
                    or type(sample["iteration"]) not in (int, str)
                    or not isinstance(sample["text"], str) or len(sample["text"]) > 4000):
                raise AcceptanceError("Invalid sample evidence")
        for fixture in fixtures:
            seen = [sample for sample in samples if sample["id"] == fixture["id"] and sample["iteration"] != "recovery"]
            for sample in seen:
                latency = sample["latencyMs"]
                if fixture["kind"] == "speech":
                    count, total = word_errors(fixture["expectedText"], sample["text"])
                    edits += count
                    words += total
                    latencies.append(latency)
                    if count / total > thresholds.max_case_wer:
                        errors.append(f"Speech WER exceeds threshold: {fixture['id']}")
                else:
                    passed = not normalize_german(sample["text"])
                    vad.append({"id": fixture["id"], "kind": fixture["kind"], "passed": passed})
                    if not passed:
                        errors.append(f"VAD hallucination: {fixture['id']}")
            if fixture["kind"] == "speech":
                stable = len({normalize_german(s["text"]) for s in seen}) == 1
                repeat.append({"id": fixture["id"], "count": len(seen), "passed": stable})
                if not stable:
                    errors.append(f"Repeated transcription changed: {fixture['id']}")
        recovery = [s for s in samples if s["iteration"] == "recovery"]
        malformed = dict(report["malformed"])
        if len(recovery) != 1 or recovery[0]["id"] != speech[0]["id"]:
            raise AcceptanceError("Missing malformed-request recovery")
        count, total = word_errors(speech[0]["expectedText"], recovery[0]["text"])
        malformed["recoveryPassed"] = count / total <= thresholds.max_case_wer
        malformed["passed"] = malformed["status"] in (400, 422) and malformed["recoveryPassed"]
        if not malformed["passed"]:
            errors.append("Malformed-request recovery failed")
        health = report["health"]
        if len(health) != 3 or not all(h["passed"] is True and h["status"] == 200 for h in health):
            raise AcceptanceError("Incomplete health evidence")
        aggregate = edits / words
        p50 = statistics.median(latencies)
        p95 = sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1]
        if aggregate > thresholds.max_aggregate_wer:
            errors.append("Aggregate WER exceeds threshold")
        if p50 > thresholds.max_p50_ms or p95 > thresholds.max_p95_ms:
            errors.append("Speech latency exceeds threshold")
        return {"passed": not errors, "errors": errors, "aggregateWer": aggregate,
                "p50Ms": p50, "p95Ms": p95, "vad": vad, "repeat": repeat, "malformed": malformed}
    except (KeyError, TypeError, ValueError, ZeroDivisionError, AttributeError):
        errors.append("Incomplete or invalid acceptance evidence")
        return {"passed": False, "errors": errors, "aggregateWer": None,
                "p50Ms": None, "p95Ms": None, "vad": vad, "repeat": repeat}


def compare_reports(baseline, candidate, *, thresholds=Thresholds()):
    """Require complete passing runs with the same reviewed corpus and thresholds."""
    thresholds.validate()
    errors = []
    scores = []
    for label, report in (("baseline", baseline), ("candidate", candidate)):
        if not isinstance(report, dict):
            errors.append(f"Invalid {label} report")
            continue
        score = _score(report, thresholds)
        scores.append(score)
        if (report.get("passed") is not True or not score["passed"]
                or report.get("thresholds") != asdict(thresholds)
                or any(type(report.get(key)) not in (int, float) for key in ("aggregateWer", "p50Ms", "p95Ms"))
                or any(report.get(key) != score[key] for key in ("aggregateWer", "p50Ms", "p95Ms", "vad", "repeat", "malformed"))):
            errors.append(f"Incomplete, failing or inconsistent {label} report")
    if not errors:
        if (baseline["manifestSha256"] != candidate["manifestSha256"]
                or baseline["reviewedBy"] != candidate["reviewedBy"]
                or baseline["fixtures"] != candidate["fixtures"]):
            errors.append("Baseline and candidate corpus differs")
        before, after = scores
        if after["aggregateWer"] > before["aggregateWer"] + thresholds.max_wer_regression:
            errors.append("Candidate WER regressed")
        for metric in ("p50Ms", "p95Ms"):
            if after[metric] > before[metric] * thresholds.max_latency_ratio + thresholds.max_latency_increase_ms:
                errors.append(f"Candidate {metric} regressed")
    return {"passed": not errors, "errors": errors, "thresholds": asdict(thresholds)}

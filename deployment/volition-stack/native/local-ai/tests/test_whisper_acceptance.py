"""Offline unit fixtures are arbitrary PCM, never speech acceptance evidence."""

import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("whisper_acceptance", HERE.parent / "whisper_acceptance.py")
acceptance = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = acceptance
spec.loader.exec_module(acceptance)


def wav(value, channels=1, rate=16000, width=2, frames=16000):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(channels)
        audio.setframerate(rate)
        audio.setsampwidth(width)
        audio.writeframes(bytes([value, 0]) * frames * channels)
    return buffer.getvalue()


def digest(data):
    return hashlib.sha256(data).hexdigest()


class CorpusFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.manifest = {"schemaVersion": 1, "synthetic": True, "language": "de",
                         "reviewedBy": "unit-test fixture; not an audio acceptance corpus", "fixtures": []}
        for index, kind in enumerate(("speech", "speech", "speech", "silence", "noise")):
            name = f"fixture-{index}"
            data = wav(0 if kind == "silence" else index + 1)
            (self.root / f"{name}.wav").write_bytes(data)
            self.manifest["fixtures"].append({"id": name, "kind": kind, "file": f"{name}.wav",
                                              "sha256": digest(data), "expectedText": "Heute prüfen wir die deutsche Sprache genau." if kind == "speech" else ""})

    def load(self):
        raw = json.dumps(self.manifest, ensure_ascii=False).encode()
        (self.root / "manifest.json").write_bytes(raw)
        return acceptance.load_corpus(self.root, digest(raw))


class CorpusTests(CorpusFixture):
    def test_valid_corpus_retains_checked_bytes(self):
        corpus = self.load()
        self.assertEqual(len(corpus.fixtures), 5)
        self.assertEqual(corpus.fixtures[0].duration_seconds, 1)
        checked = corpus.fixtures[0].wav
        (self.root / corpus.fixtures[0].filename).write_bytes(b"changed later")
        self.assertEqual(corpus.fixtures[0].wav, checked)
        with self.assertRaises(acceptance.AcceptanceError):
            self.load()

    def test_manifest_requires_independently_supplied_hash(self):
        self.load()
        for pin in (None, "", "F" * 64, "0" * 64):
            with self.subTest(pin=pin), self.assertRaises(acceptance.AcceptanceError):
                acceptance.load_corpus(self.root, pin)

    def test_requires_reviewed_synthetic_german(self):
        original = copy.deepcopy(self.manifest)
        for key, value in (("schemaVersion", True), ("synthetic", False), ("language", "en"), ("reviewedBy", " "), ("reviewedBy", 3)):
            self.manifest = {**original, key: value}
            with self.subTest(key=key), self.assertRaises(acceptance.AcceptanceError):
                self.load()

    def test_requires_complete_distinct_corpus(self):
        original = copy.deepcopy(self.manifest)
        for change in (lambda rows: rows.pop(), lambda rows: rows.__setitem__(1, rows[0]),
                       lambda rows: rows[4].update(kind="speech", expectedText=rows[0]["expectedText"]),
                       lambda rows: rows[1].update(sha256=rows[0]["sha256"]),
                       lambda rows: rows[1].update(file=rows[0]["file"])):
            self.manifest = copy.deepcopy(original)
            change(self.manifest["fixtures"])
            with self.assertRaises(acceptance.AcceptanceError):
                self.load()

    def test_rejects_unsafe_paths_and_urls(self):
        for filename in ("../outside.wav", "/tmp/outside.wav", "http://127.0.0.1/a.wav", "subdir/a.wav"):
            self.manifest["fixtures"][0]["file"] = filename
            with self.subTest(filename=filename), self.assertRaises(acceptance.AcceptanceError):
                self.load()

    def test_rejects_symlinks_in_files_and_corpus_ancestry(self):
        self.load()
        target = self.root / "fixture-0.wav"
        target.rename(self.root / "original.wav")
        target.symlink_to(self.root / "original.wav")
        with self.assertRaises(acceptance.AcceptanceError):
            self.load()
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises((acceptance.AcceptanceError, OSError)):
            acceptance.load_corpus(alias, digest((self.root / "manifest.json").read_bytes()))

    def test_rejects_nonregular_files_without_blocking(self):
        path = self.root / "fixture-0.wav"
        path.unlink()
        os.mkfifo(path)
        with self.assertRaises(acceptance.AcceptanceError):
            self.load()

    def test_only_pcm16_mono_16khz_with_bounded_duration(self):
        for data in (wav(1, channels=2), wav(1, rate=8000), wav(1, width=1), wav(1, frames=10), wav(1, frames=320001), wav(1)[:-10], b"not wave"):
            (self.root / "fixture-0.wav").write_bytes(data)
            self.manifest["fixtures"][0]["sha256"] = digest(data)
            with self.assertRaises(acceptance.AcceptanceError):
                self.load()

    def test_requires_real_silence_and_nonzero_speech_noise(self):
        original = copy.deepcopy(self.manifest)
        for index, data in ((0, wav(0, frames=8000)), (3, wav(9)), (4, wav(0, frames=12000))):
            self.manifest = copy.deepcopy(original)
            path = self.root / f"fixture-{index}.wav"
            previous = path.read_bytes()
            path.write_bytes(data)
            self.manifest["fixtures"][index]["sha256"] = digest(data)
            with self.assertRaises(acceptance.AcceptanceError):
                self.load()
            path.write_bytes(previous)

    def test_total_bytes_bounded(self):
        with patch.object(acceptance, "MAX_TOTAL", 100000), self.assertRaises(acceptance.AcceptanceError):
            self.load()

    def test_transcript_contract(self):
        for index, text in ((0, "Zu kurz"), (3, "hallucination"), (0, 42)):
            old = self.manifest["fixtures"][index]["expectedText"]
            self.manifest["fixtures"][index]["expectedText"] = text
            with self.assertRaises(acceptance.AcceptanceError):
                self.load()
            self.manifest["fixtures"][index]["expectedText"] = old


class FakeWhisper:
    def __init__(self, corpus):
        self.corpus = corpus
        self.calls = []
        self.texts = {}
        self.latency = 100
        self.malformed_status = 400
        self.recovery_text = None
        self.malformed_seen = False
        self.seen = {}

    def __call__(self, port, method, path, body, headers, timeout_s):
        self.calls.append((port, method, path, body, headers, timeout_s))
        if path == "/v1/health":
            return acceptance.HttpResult(200, b'{"status":"ok"}', 1)
        for fixture in self.corpus.fixtures:
            if fixture.wav in body:
                self.seen[fixture.id] = self.seen.get(fixture.id, 0) + 1
                text = self.texts.get(fixture.id, fixture.expected_text)
                if isinstance(text, list):
                    text = text[self.seen[fixture.id] - 1]
                if self.malformed_seen and self.recovery_text is not None:
                    text = self.recovery_text
                return acceptance.HttpResult(200, json.dumps({"text": text}).encode(), self.latency)
        self.malformed_seen = True
        return acceptance.HttpResult(self.malformed_status, b'{"error":"invalid audio"}', 1)


class AcceptanceTests(CorpusFixture):
    def setUp(self):
        super().setUp()
        self.corpus = self.load()
        self.fake = FakeWhisper(self.corpus)

    def run_fake(self, fake=None):
        return acceptance.run_server(13346, self.corpus, request=fake or self.fake)

    def test_complete_synthetic_fake_run(self):
        report = self.run_fake()
        self.assertTrue(report["passed"], report["errors"])
        self.assertEqual(report["aggregateWer"], 0)
        self.assertEqual(report["p50Ms"], 100)
        self.assertEqual(len(report["repeat"]), 3)
        self.assertEqual(len(report["vad"]), 2)
        self.assertTrue(report["malformed"]["passed"])
        self.assertEqual(len(self.fake.calls), 16)
        self.assertTrue(all(call[0] == 13346 for call in self.fake.calls))
        self.assertIn(b'name="language"\r\n\r\nde', self.fake.calls[1][3])
        self.assertTrue(acceptance.compare_reports(report, report)["passed"])

    def test_bad_accuracy_fails(self):
        self.fake.texts["fixture-0"] = "These completely wrong English words are not German"
        report = self.run_fake()
        self.assertFalse(report["passed"])
        self.assertGreater(report["aggregateWer"], .1)

    def test_vad_hallucination_fails(self):
        for name in ("fixture-3", "fixture-4"):
            fake = FakeWhisper(self.corpus)
            fake.texts[name] = "Vielen Dank fürs Zuschauen"
            report = self.run_fake(fake)
            self.assertFalse(report["passed"])
            self.assertIn(f"VAD hallucination: {name}", report["errors"])

    def test_repeated_speech_instability_fails_even_under_wer_limit(self):
        text = self.corpus.fixtures[0].expected_text
        self.fake.texts["fixture-0"] = [text, text.replace("Heute", "Morgen"), text, text]
        report = self.run_fake()
        self.assertFalse(report["passed"])
        self.assertIn("Repeated transcription changed: fixture-0", report["errors"])

    def test_malformed_must_reject_and_recover(self):
        for status in (200, 301, 500):
            fake = FakeWhisper(self.corpus)
            fake.malformed_status = status
            report = self.run_fake(fake)
            self.assertFalse(report["passed"])
        self.fake.recovery_text = "no longer working"
        report = self.run_fake()
        self.assertFalse(report["passed"])
        self.assertFalse(report["malformed"]["recoveryPassed"])

    def test_health_transcript_shape_failures_and_timeouts_fail_closed(self):
        for response in (acceptance.HttpResult(503, b'{}', 1), acceptance.HttpResult(200, b'[]', 1),
                         acceptance.HttpResult(200, b'{"status":"ok"}', 21000),
                         acceptance.HttpResult(200, b'x' * (acceptance.MAX_RESPONSE + 1), 1),
                         acceptance.HttpResult(200, b'{"status":"ok"}', float("nan"))):
            report = self.run_fake(lambda *args: response)
            self.assertFalse(report["passed"])
        self.fake.texts["fixture-0"] = None
        self.assertFalse(self.run_fake()["passed"])
        with patch.object(acceptance.time, "monotonic", side_effect=[0, 181]):
            self.assertFalse(self.run_fake()["passed"])
        self.assertFalse(self.run_fake(Mock(side_effect=TimeoutError("bounded timeout")))["passed"])

    def test_latency_absolute_and_relative_limits(self):
        baseline = self.run_fake()
        fake = FakeWhisper(self.corpus)
        fake.latency = 250
        candidate = self.run_fake(fake)
        self.assertTrue(candidate["passed"])
        self.assertFalse(acceptance.compare_reports(baseline, candidate)["passed"])
        fake.latency = 2100
        self.assertFalse(self.run_fake(fake)["passed"])

    def test_wer_regression_against_good_baseline_fails(self):
        baseline = self.run_fake()
        fake = FakeWhisper(self.corpus)
        fake.texts["fixture-0"] = self.corpus.fixtures[0].expected_text.replace("Heute", "Morgen")
        candidate = self.run_fake(fake)
        self.assertTrue(candidate["passed"], candidate["errors"])
        self.assertFalse(acceptance.compare_reports(baseline, candidate)["passed"])

    def test_incomplete_or_inconsistent_baseline_is_never_accepted(self):
        good = self.run_fake()
        variants = [None, {}, {**good, "passed": False}, {**good, "samples": good["samples"][:-1]},
                    {**good, "health": good["health"][:-1]}, {**good, "aggregateWer": None},
                    {**good, "malformed": {}}, {**good, "repeat": []}, {**good, "thresholds": {}},
                    {**good, "errors": ["prior failure"]}, {**good, "fixtures": []}]
        for index, baseline in enumerate(variants):
            with self.subTest(index=index):
                self.assertFalse(acceptance.compare_reports(baseline, good)["passed"])

    def test_requires_same_corpus(self):
        good = self.run_fake()
        changed = {**good, "manifestSha256": "0" * 64}
        self.assertFalse(acceptance.compare_reports(good, changed)["passed"])

    def test_malformed_report_fields_fail_closed_without_exceptions(self):
        good = self.run_fake()
        for key in ("schemaVersion", "port", "manifestSha256", "reviewedBy", "errors", "samples", "fixtures", "health", "malformed", "thresholds"):
            for value in (None, False, 42, "invalid", [], {}):
                if value == good.get(key) and type(value) is type(good.get(key)):
                    continue
                changed = {**good, key: value}
                with self.subTest(key=key, value=value):
                    self.assertFalse(acceptance.compare_reports(changed, good)["passed"])

    def test_every_required_report_field_must_be_present(self):
        good = self.run_fake()
        for key in good:
            changed = dict(good)
            del changed[key]
            with self.subTest(key=key):
                self.assertFalse(acceptance.compare_reports(changed, good)["passed"])

    def test_recovery_latency_and_unique_iterations_are_required(self):
        good = self.run_fake()
        for mutate in (lambda samples: samples[-1].update(latencyMs=float("nan")),
                       lambda samples: samples[-1].update(text=None),
                       lambda samples: samples[0].update(iteration=True),
                       lambda samples: samples.__setitem__(0, samples[1])):
            changed = copy.deepcopy(good)
            mutate(changed["samples"])
            self.assertFalse(acceptance.compare_reports(changed, good)["passed"])

    def test_invalid_ports_and_thresholds_do_not_send(self):
        fake = Mock()
        for port in (True, 0, 80, 65536, "http://127.0.0.1:13306", "13306"):
            with self.assertRaises(acceptance.AcceptanceError):
                acceptance.run_server(port, self.corpus, request=fake)
        for settings in ({"request_timeout_s": 100}, {"total_timeout_s": float("inf")}, {"max_case_wer": 1}):
            with self.assertRaises(acceptance.AcceptanceError):
                acceptance.run_server(13306, self.corpus, request=fake, thresholds=acceptance.Thresholds(**settings))
        fake.assert_not_called()


class TextTests(unittest.TestCase):
    def test_german_normalization_preserves_words_numbers_and_umlauts(self):
        self.assertEqual(acceptance.normalize_german("GRÜẞE, Jörg! 42 — Äpfel."), "grüsse jörg 42 äpfel")
        self.assertEqual(acceptance.normalize_german("Mu\u0308nchen"), "münchen")
        self.assertNotEqual(acceptance.normalize_german("schon"), acceptance.normalize_german("schön"))
        self.assertNotEqual(acceptance.normalize_german("42"), acceptance.normalize_german("zweiundvierzig"))

    def test_wer_insertions_deletions_substitutions(self):
        self.assertEqual(acceptance.word_errors("eins zwei drei", "eins vier"), (2, 3))
        self.assertEqual(acceptance.word_errors("Guten Tag", "guten schönen tag"), (1, 2))
        self.assertEqual(acceptance.word_errors("Straße in München.", "STRASSE IN MÜNCHEN"), (0, 3))


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = Mock()
        self.response = self.connection.getresponse.return_value
        self.response.status = 200
        self.response.getheader.return_value = None
        self.response.read.return_value = b'{"status":"ok"}'
        self.factory = patch.object(acceptance.http.client, "HTTPConnection", return_value=self.connection).start()
        self.timer = patch.object(acceptance.threading, "Timer").start()
        self.addCleanup(patch.stopall)

    def request(self):
        return acceptance.http_request(13306, "GET", "/v1/health", b"", {}, 2)

    def test_literal_loopback_no_redirects_bounded_read_and_cleanup(self):
        result = self.request()
        self.assertEqual(result.status, 200)
        self.factory.assert_called_once_with("127.0.0.1", 13306, timeout=2)
        self.response.read.assert_called_once_with(acceptance.MAX_RESPONSE + 1)
        self.connection.close.assert_called_once()
        self.timer.return_value.cancel.assert_called_once()

    def test_deadline_interrupts_socket_even_while_headers_are_read(self):
        self.timer.return_value.start.side_effect = lambda: self.timer.call_args.args[1]()
        self.connection.getresponse.side_effect = ConnectionResetError()
        with self.assertRaises(acceptance.AcceptanceError):
            self.request()
        self.connection.sock.shutdown.assert_called_once_with(acceptance.socket.SHUT_RDWR)
        self.timer.return_value.cancel.assert_called_once()
        self.connection.close.assert_called_once()

    def test_response_limits_and_invalid_lengths(self):
        for length in (str(acceptance.MAX_RESPONSE + 1), "garbage", "-1"):
            self.response.getheader.return_value = length
            with self.assertRaises(acceptance.AcceptanceError):
                self.request()
        self.response.getheader.return_value = None
        self.response.read.return_value = b"x" * (acceptance.MAX_RESPONSE + 1)
        with self.assertRaises(acceptance.AcceptanceError):
            self.request()

    def test_unapproved_endpoint_never_connects(self):
        for method, path in (("POST", "/load"), ("GET", "https://example.invalid"), ("GET", "/v1/health?x=1")):
            with self.assertRaises(acceptance.AcceptanceError):
                acceptance.http_request(13306, method, path, b"", {}, 2)
        self.factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()

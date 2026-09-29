"""Regenerate deterministic, synthetic wake-word recordings with installed FFmpeg/flite."""

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "recordings"
OUT.mkdir(exist_ok=True)
PHRASES = {
    "ava": (True, "Ava, mach das Licht an"),
    "eywa": (True, "Eywa, mach das Licht an"),
    "ewa": (True, "Ewa, mach das Licht an"),
    "aiwa": (True, "Aiwa, mach das Licht an"),
    "aber": (False, "Aber mach das Licht an"),
    "eva": (False, "Eva macht das Licht an"),
    "hawaii": (False, "Hawaii liegt weit weg"),
    "einwandfrei": (False, "Das ist einwandfrei"),
}

records = []
for voice in ("kal", "slt"):
    for tempo in ("0.85", "1.20"):
        for name, (positive, sentence) in PHRASES.items():
            noisy = tempo == "1.20" and name in ("ava", "eywa", "aber", "eva")
            filename = f"{name}-{voice}-{tempo}{'-noise' if noisy else ''}.wav"
            command = [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", f"flite=text='{sentence}':voice={voice}",
            ]
            if noisy:
                command += ["-f", "lavfi", "-i", "anoisesrc=d=20:c=white:r=16000:seed=108"]
                command += ["-filter_complex", f"[0:a]atempo={tempo}[speech];[1:a]volume=0.015[noise];[speech][noise]amix=inputs=2:duration=first[a]", "-map", "[a]"]
            else:
                command += ["-af", f"atempo={tempo}"]
            command += ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(OUT / filename)]
            subprocess.run(command, check=True)
            records.append({"file": filename, "wake": positive, "phrase": sentence, "voice": voice, "tempo": float(tempo), "noise": noisy})

(HERE / "manifest.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")

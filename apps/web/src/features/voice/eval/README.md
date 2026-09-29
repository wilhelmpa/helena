# Ava wake-word evaluation

`generate.py` recreates 32 local WAV recordings and `manifest.json` using the FFmpeg
`flite` filter already installed on the test machine. The set covers four written
forms, four similar negative words, two voices, two speaking rates, and white-noise
mixtures. The voices speak English and therefore do not represent German speakers.

To evaluate an already installed German on-device browser recognition pack, serve this
directory on localhost, open `run.html`, and press the button:

```sh
cd apps/web/src/features/voice/eval
python3 -m http.server 8765 --bind 127.0.0.1
```

The page uses `SpeechRecognition.available({langs:['de-DE'], processLocally:true})`
and `recognition.start(audioTrack)`. It does not install a language pack or send audio
to an application server. If the browser lacks either API, the evaluation stops.
Record the browser version, device, CPU utilization during the run, and the JSON
result. The included negative audio lasts about 28 seconds, so it cannot establish
a false-positive rate below one per hour. Qualifying that target requires hours of
real German speech and noise from the intended microphones, plus human recordings
of “Eywa” for the recall target.

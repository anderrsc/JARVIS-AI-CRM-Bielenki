"""Run inside the voice container; credentials stay in its environment."""
import json
import os
import time
import urllib.request
from pathlib import Path

key = os.environ.get("JARVIS_VOICE_KEY") or os.environ["JARVIS_USER_KEY"]
base = os.environ.get("VOICE_VERIFY_URL", "http://127.0.0.1:8010")
headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
health = urllib.request.Request(base + "/health", headers=headers)
print(urllib.request.urlopen(health, timeout=10).read().decode(), flush=True)
payload = json.dumps({"text": os.environ.get("VOICE_VERIFY_TEXT", "Pois não, senhor. Estou pronto para ajudar.")}).encode()
started = time.monotonic()
request = urllib.request.Request(base + "/v1/tts", data=payload, headers=headers)
with urllib.request.urlopen(request, timeout=180) as response:
    audio = response.read()
assert audio.startswith(b"RIFF"), "Invalid WAV output"
Path("/app/audio-cache/verification.wav").write_bytes(audio)
print(json.dumps({"seconds": round(time.monotonic() - started, 2), "bytes": len(audio)}), flush=True)

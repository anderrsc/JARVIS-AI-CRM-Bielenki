"""JARVIS voice: Kokoro-82M (Apache 2.0) with a free Brazilian Portuguese preset voice.

No cloned voices and no provider API: weights live in ./kokoro and run offline on CPU.
A light "HUD" filter (band-pass, compression, short room echo) gives the assistant character.
"""
import hashlib
import hmac
import os
import subprocess
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
KOKORO_DIR = BASE / "kokoro"
CACHE = BASE / "audio-cache"
KEY = os.environ.get("JARVIS_VOICE_KEY") or os.environ.get("JARVIS_USER_KEY", "")
VOICE = os.environ.get("JARVIS_VOICE_PRESET", "pm_alex")
SPEED = float(os.environ.get("JARVIS_VOICE_SPEED", "0.92"))
# Subtle: keeps words clear, adds the "assistant on a speaker" color.
HUD_FILTER = "highpass=f=110,lowpass=f=7600,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,aecho=0.85:0.5:18:0.12,volume=1.4"
SAMPLE_RATE = 24000
VERSION = "kokoro-0.9.4-v2"
PIPELINE = None
LOCK = threading.Lock()


def weights_ready():
    return (KOKORO_DIR / "kokoro-v1_0.pth").is_file() and (KOKORO_DIR / "voices" / f"{VOICE}.pt").is_file()


def load_pipeline():
    """Local weights only; the English G2P is never initialized for Portuguese."""
    from kokoro import KModel, KPipeline
    model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(KOKORO_DIR / "config.json"), model=str(KOKORO_DIR / "kokoro-v1_0.pth")).eval()
    return KPipeline(lang_code="p", repo_id="hexgrad/Kokoro-82M", model=model)


def generate(text):
    import numpy as np
    import torch
    with torch.inference_mode():
        chunks = [r.audio.numpy() for r in PIPELINE(text, voice=str(KOKORO_DIR / "voices" / f"{VOICE}.pt"), speed=SPEED) if r.audio is not None]
    return np.concatenate(chunks) if chunks else np.zeros(SAMPLE_RATE // 10, dtype="float32")


def hud(raw: Path, target: Path):
    """Apply the HUD filter with ffmpeg; fall back to the clean voice if it fails."""
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", HUD_FILTER, "-ar", str(SAMPLE_RATE), "-ac", "1", str(target)], check=True, timeout=30)
        raw.unlink(missing_ok=True)
    except (OSError, subprocess.SubprocessError):
        raw.replace(target)


@asynccontextmanager
async def lifespan(app):
    global PIPELINE
    if len(KEY) < 24:
        raise RuntimeError("JARVIS_VOICE_KEY must contain at least 24 characters")
    if not weights_ready():
        raise RuntimeError("Run prepare.py before starting the voice server")
    import torch
    CACHE.mkdir(exist_ok=True)
    torch.set_num_threads(int(os.environ.get("VOICE_THREADS", "4")))
    PIPELINE = load_pipeline()
    print("Warming Portuguese voice", flush=True)
    synthesize(Speech(text="Pois não, senhor."), authorization=f"Bearer {KEY}")
    print("Portuguese voice ready", flush=True)
    yield
    PIPELINE = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class Speech(BaseModel):
    text: str = Field(min_length=1, max_length=1200)


def authenticate(value):
    if not hmac.compare_digest(value or "", f"Bearer {KEY}"):
        raise HTTPException(401, "Unauthorized")


@app.get("/health")
def health(authorization: str | None = Header(default=None)):
    authenticate(authorization)
    return {"ready": PIPELINE is not None, "provider": "local", "voice": VOICE}


@app.post("/v1/tts")
def synthesize(body: Speech, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Empty text")
    if not LOCK.acquire(blocking=False):
        raise HTTPException(429, "Voice busy")
    try:
        # Generated audio stays on this server; same text + voice reuses the file.
        identity = f"{VERSION}|{VOICE}|{SPEED}|{HUD_FILTER}|{text}".encode("utf8")
        target = CACHE / (hashlib.sha256(identity).hexdigest() + ".wav")
        if not target.is_file():
            import soundfile as sf
            raw = target.with_suffix(".raw.wav")
            sf.write(str(raw), generate(text), SAMPLE_RATE)
            hud(raw, target)
        return FileResponse(target, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})
    finally:
        LOCK.release()

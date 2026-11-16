"""Own Portuguese voice synthesis. No provider API; weights are stored locally."""
import hashlib
import hmac
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
REFERENCE = BASE / "reference.wav"
MODEL_DIR = BASE / "model"
CACHE = BASE / "audio-cache"
KEY = os.environ.get("JARVIS_VOICE_KEY") or os.environ.get("JARVIS_USER_KEY", "")
MODEL = None
LOCK = threading.Lock()
DEVICE = os.environ.get("JARVIS_VOICE_DEVICE", "cuda")


@asynccontextmanager
async def lifespan(app):
    global MODEL
    if len(KEY) < 24:
        raise RuntimeError("JARVIS_VOICE_KEY must contain at least 24 characters")
    if not REFERENCE.is_file() or not MODEL_DIR.is_dir():
        raise RuntimeError("Run prepare.py before starting the voice server")
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    CACHE.mkdir(exist_ok=True)
    torch.set_num_threads(int(os.environ.get("VOICE_THREADS", "4")))
    MODEL = ChatterboxMultilingualTTS.from_local(MODEL_DIR, DEVICE)
    MODEL.prepare_conditionals(str(REFERENCE), exaggeration=0.35)
    yield
    MODEL = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class Speech(BaseModel):
    text: str = Field(min_length=1, max_length=1200)


def authenticate(value):
    if not hmac.compare_digest(value or "", f"Bearer {KEY}"):
        raise HTTPException(401, "Unauthorized")


@app.get("/health")
def health(authorization: str | None = Header(default=None)):
    authenticate(authorization)
    return {"ready": MODEL is not None, "provider": "local", "device": DEVICE}


@app.post("/v1/tts")
def synthesize(body: Speech, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Empty text")
    if not LOCK.acquire(blocking=False):
        raise HTTPException(429, "Voice busy")
    try:
        # Persistent generated audio remains on the user's own machine.
        identity = REFERENCE.read_bytes() + text.encode("utf8") + b"chatterbox-0.1.7-pt-v1"
        target = CACHE / (hashlib.sha256(identity).hexdigest() + ".wav")
        if not target.is_file():
            import soundfile as sf
            import torch
            with torch.inference_mode():
                wav = MODEL.generate(text, language_id="pt", exaggeration=0.35, cfg_weight=0.5)
            temporary = target.with_suffix(".tmp.wav")
            sf.write(str(temporary), wav.squeeze(0).cpu().numpy(), MODEL.sr)
            temporary.replace(target)
        return FileResponse(target, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})
    finally:
        LOCK.release()


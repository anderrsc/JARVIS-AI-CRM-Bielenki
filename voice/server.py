"""Own Portuguese voice synthesis. No provider API; weights are stored locally."""
import hashlib
import hmac
import os
import threading
import gc
from functools import partial
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

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
STEPS = int(os.environ.get("JARVIS_VOICE_STEPS", "10"))


def load_cpu_model():
    """Assign memory-mapped weights; quantize the language model before the vocoder."""
    import torch
    from safetensors.torch import load_file
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.models.t3 import T3
    from chatterbox.models.t3.modules.t3_config import T3Config
    from chatterbox.models.s3gen import S3Gen
    from chatterbox.models.voice_encoder import VoiceEncoder
    from chatterbox.models.tokenizers import MTLTokenizer

    print("Loading local voice encoder", flush=True)
    ve = VoiceEncoder()
    ve.load_state_dict(torch.load(MODEL_DIR / "ve.pt", map_location="cpu", weights_only=True, mmap=True), assign=True)
    ve.eval()
    print("Loading and quantizing local language model", flush=True)
    t3 = T3(T3Config.multilingual())
    t3.load_state_dict(load_file(str(MODEL_DIR / "t3_mtl23ls_v2.safetensors")), assign=True)
    t3.eval()
    # Keep output heads in float: Chatterbox reads their weight.device directly.
    torch.ao.quantization.quantize_dynamic(t3.tfmr, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)
    gc.collect()
    print("Loading local speech decoder", flush=True)
    s3gen = S3Gen()
    s3gen.load_state_dict(torch.load(MODEL_DIR / "s3gen.pt", map_location="cpu", weights_only=True, mmap=True), assign=True)
    s3gen.eval()
    tokenizer = MTLTokenizer(str(MODEL_DIR / "grapheme_mtl_merged_expanded_v1.json"))
    return ChatterboxMultilingualTTS(t3, s3gen, ve, tokenizer, "cpu")


@asynccontextmanager
async def lifespan(app):
    global MODEL
    if len(KEY) < 24:
        raise RuntimeError("JARVIS_VOICE_KEY must contain at least 24 characters")
    if not REFERENCE.is_file() or not MODEL_DIR.is_dir():
        raise RuntimeError("Run prepare.py before starting the voice server")
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.models.tokenizers.tokenizer import ChineseCangjieConverter
    CACHE.mkdir(exist_ok=True)
    torch.set_num_threads(int(os.environ.get("VOICE_THREADS", "4")))
    # Portuguese-only service: don't download or initialize unrelated Chinese models.
    with patch.object(ChineseCangjieConverter, "_load_cangjie_mapping", return_value=None), patch.object(ChineseCangjieConverter, "_init_segmenter", return_value=None):
        MODEL = load_cpu_model() if DEVICE == "cpu" else ChatterboxMultilingualTTS.from_local(MODEL_DIR, DEVICE)
    print("Preparing original voice reference", flush=True)
    MODEL.prepare_conditionals(str(REFERENCE), exaggeration=0.35)
    MODEL.s3gen.inference = partial(MODEL.s3gen.inference, n_cfm_timesteps=STEPS)
    # Compile/warm the decoder before accepting traffic; retain the common opening.
    print("Warming Portuguese voice", flush=True)
    synthesize(Speech(text="Pois não, senhor."), authorization=f"Bearer {KEY}")
    print("Portuguese voice ready", flush=True)
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
        identity = REFERENCE.read_bytes() + text.encode("utf8") + f"chatterbox-0.1.7-pt-v1-steps-{STEPS}".encode()
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


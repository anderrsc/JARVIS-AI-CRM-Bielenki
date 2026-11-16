FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 ffmpeg git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY server.py prepare.py verify.py ./
ENV JARVIS_VOICE_DEVICE=cpu HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=4 NUMBA_CACHE_DIR=/app/audio-cache/numba
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8010", "--limit-concurrency", "4"]

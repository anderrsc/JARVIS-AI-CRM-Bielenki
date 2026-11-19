FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
# Free voice weights (Kokoro-82M, Apache 2.0) are baked into the image; runtime is offline.
COPY prepare.py .
RUN python prepare.py
COPY server.py verify.py ./
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=4
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8010", "--limit-concurrency", "4"]

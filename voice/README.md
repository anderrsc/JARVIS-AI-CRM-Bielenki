# Voz própria do JARVIS

Chatterbox Multilingual (MIT), com português e referência do MP3 fornecido. Não é uma cópia do modelo proprietário do Fish Audio. A semelhança precisa ser avaliada ouvindo a síntese; nenhum modelo promete timbre idêntico.

Os pesos são baixados uma vez. Depois, `server.py` carrega de `model/`, sem conta, assinatura ou API de terceiros. Guarde a pasta `model/`, `reference.wav` e o ambiente Python para manter a operação independente. Os WAV gerados ficam em `audio-cache/`; proteja e faça backup dessa pasta porque as respostas podem conter dados privados. O cache não é publicado no GitHub.

## Preparar

Python 3.12 e uma GPU NVIDIA são recomendados. A máquina de desenvolvimento tem RTX 3060 de 12 GB. A implantação CPU na VPS usa limites explícitos de 2300 MB de RAM, 4300 MB com swap e duas CPUs. Em hardware limitado, as falas são curtas, com o restante na tela; o tempo precisa ser medido antes de prometer resposta em tempo real.

```powershell
python -m venv voice/.venv
voice/.venv/Scripts/python.exe -m pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
voice/.venv/Scripts/python.exe -m pip install -r voice/requirements.txt
voice/.venv/Scripts/python.exe voice/prepare.py
```

Converta de 6 a 10 segundos limpos da amostra para `voice/reference.wav`, mono a 24 kHz com FFmpeg. Escolha uma frase inteira, sem música. O arquivo é uma referência de timbre, não um conjunto de treinamento.

## Executar

Defina `JARVIS_VOICE_KEY` com pelo menos 24 caracteres e rode:

```powershell
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
voice/.venv/Scripts/python.exe -m uvicorn voice.server:app --host 127.0.0.1 --port 8010
```

O painel usa `JARVIS_VOICE_URL` e `JARVIS_VOICE_KEY`, somente no servidor. Na VPS, usa automaticamente o caminho `/voice` de `JARVIS_API_URL` e a chave existente `JARVIS_USER_KEY`. O serviço expõe `POST /v1/tts` e `GET /health`, ambos com `Authorization: Bearer`. O Caddy recebe HTTPS e encaminha ao container pela rede interna; a porta de síntese não é exposta ao público. Sem VPS configurada, uma instalação local pode ser ligada por túnel privado e precisa permanecer ligada. CPU, GPU e energia são recursos próprios, sem cobrança por API.

O Fish Audio é apenas uma ponte opcional se `FISH_AUDIO_API_KEY` estiver configurada. O código usa exclusivamente `s2.1-pro-free`, bloqueia após 30/11/2026 UTC e não tenta modelos pagos nem troca de voz silenciosamente.

Fontes: https://github.com/resemble-ai/chatterbox e https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech

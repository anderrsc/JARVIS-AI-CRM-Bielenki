# Voz do JARVIS

Kokoro-82M (licença Apache 2.0) com a voz livre `pm_alex`, masculina, em português do Brasil. Por cima entra um efeito leve de "HUD" (filtro de banda, compressão e um eco curto) feito com FFmpeg. Nenhuma voz real é clonada: não há amostra de referência de ator, dublador ou outra pessoa.

Os pesos (~330 MB) são baixados no `docker build` por `prepare.py` e ficam dentro da imagem. Em execução o serviço funciona offline, sem conta nem API paga. Os WAV gerados ficam no volume `voice_audio`; o mesmo texto reaproveita o arquivo.

## Ajustes

Em `compose.voice.yaml`:

- `JARVIS_VOICE_PRESET`: `pm_alex` (padrão, mais grave) ou `pm_santa`.
- `JARVIS_VOICE_SPEED`: `0.92` deixa a fala calma; `1.0` é a velocidade normal.

O filtro HUD está em `HUD_FILTER`, em `server.py`. Mudar voz, velocidade ou filtro gera áudio novo automaticamente.

## API

`POST /v1/tts` (`{"text": "..."}`) e `GET /health`, ambos com `Authorization: Bearer <JARVIS_VOICE_KEY ou JARVIS_USER_KEY>`. O Caddy encaminha `/voice` ao container pela rede interna; a porta não é pública. O painel chama `JARVIS_API_URL/voice` do lado do servidor.

## Testar na VPS

```bash
./compose.sh exec voice python verify.py
```

Fontes: https://huggingface.co/hexgrad/Kokoro-82M e https://github.com/hexgrad/kokoro

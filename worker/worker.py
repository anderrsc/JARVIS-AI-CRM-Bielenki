import os, time, socket, subprocess
import httpx

URL = os.environ['JARVIS_CLOUD_URL'].rstrip('/')
KEY = os.environ['JARVIS_WORKER_KEY']
WORKER_ID = os.getenv('JARVIS_WORKER_ID', socket.gethostname())
OLLAMA = os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434')
MODEL = os.getenv('OLLAMA_MODEL','qwen2.5:3b')
POLL = max(5, int(os.getenv('JARVIS_POLL_SECONDS','15')))
PROMPTS = {
 'jarvis': 'Você é JARVIS, coordenador de agentes. Responda em português. Planeje e delegue tarefas; não afirme que executou ações externas.',
 'sentinel': 'Você é SENTINEL, auditor de software. Responda em português com riscos, gravidade, evidências disponíveis e testes recomendados. Não invente testes executados.'
}

def infer(agent, prompt):
    with httpx.Client(timeout=180) as client:
        response=client.post(OLLAMA.rstrip('/')+'/api/chat',json={'model':MODEL,'stream':False,'options':{'num_ctx':2048,'num_predict':256},'messages':[
            {'role':'system','content':PROMPTS[agent]}, {'role':'user','content':prompt}]})
        response.raise_for_status()
        return response.json()['message']['content']

def cycle():
    with httpx.Client(timeout=30, headers={'X-Worker-Key':KEY}) as client:
        r=client.post(URL+'/worker/claim',params={'worker_id':WORKER_ID})
        r.raise_for_status()
        job=r.json()['job']
        if not job: return False
        try:
            answer=infer(job['agent'],job['prompt'])
            success=True
        except Exception as exc:
            answer=f'Falha no worker: {type(exc).__name__}'
            success=False
        r=client.post(URL+f"/worker/jobs/{job['id']}/complete",json={'worker_id':WORKER_ID,'result':answer[:30000] or 'Resposta vazia','success':success})
        r.raise_for_status()
        return True

if __name__=='__main__':
    if not (URL.startswith('https://') or (URL == 'http://jarvis:8000' and os.getenv('JARVIS_INTERNAL_NETWORK') == '1')):
        raise SystemExit('Configure JARVIS_CLOUD_URL com HTTPS')
    if len(KEY)<32: raise SystemExit('Configure JARVIS_WORKER_KEY com 32+ caracteres')
    print('JARVIS worker iniciado. Somente chamadas de saída via HTTPS.')
    while True:
        try: cycle()
        except Exception as exc: print('Erro de conexão:',type(exc).__name__)
        time.sleep(POLL)

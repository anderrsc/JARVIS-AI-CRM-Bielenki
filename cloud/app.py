import os, sqlite3, secrets, time, uuid
from contextlib import contextmanager
from datetime import date
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator
from typing import Literal
import office

DB = os.getenv('JARVIS_DB', '/data/jarvis.sqlite3')
USER_KEY = os.getenv('JARVIS_USER_KEY', '')
WORKER_KEY = os.getenv('JARVIS_WORKER_KEY', '')
LEASE_SECONDS = 300
app = FastAPI(title='JARVIS Cloud Queue', docs_url=None, redoc_url=None)

@contextmanager
def connection():
    os.makedirs(os.path.dirname(os.path.abspath(DB)), exist_ok=True)
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('''CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, agent TEXT NOT NULL, prompt TEXT NOT NULL,
          status TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL,
          lease_until INTEGER, worker_id TEXT, attempts INTEGER NOT NULL DEFAULT 0)''')
        conn.execute(office.SCHEMA_EMPRESAS)
        conn.execute(office.SCHEMA_EVENTOS)
        conn.execute(office.SCHEMA)
        conn.execute('CREATE INDEX IF NOT EXISTS pend_empresa_status ON pendencias(empresa,status)')
        conn.executemany('INSERT OR IGNORE INTO empresas(chave,nome) VALUES(?,?)', office.EMPRESAS.items())
        conn.commit()
        yield conn
        conn.commit()
    finally:
        conn.close()

def require_key(provided, expected):
    if len(expected) < 32 or not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(401, 'Não autorizado')

def user_auth(x_api_key: str | None = Header(None)):
    require_key(x_api_key, USER_KEY)

def worker_auth(x_worker_key: str | None = Header(None)):
    require_key(x_worker_key, WORKER_KEY)

AgentKey = Literal[tuple(office.AGENTES)]

class NewJob(BaseModel):
    agent: AgentKey = 'jarvis'
    prompt: str = Field(min_length=3, max_length=6000)

class Result(BaseModel):
    worker_id: str = Field(min_length=1, max_length=100)
    result: str = Field(min_length=1, max_length=30000)
    success: bool = True

@app.get('/health')
def health():
    return {'status': 'ok'}

def enqueue(db, agent: str, prompt: str) -> str:
    jid = str(uuid.uuid4())
    db.execute('INSERT INTO jobs(id,agent,prompt,status,created_at) VALUES(?,?,?,?,?)',
               (jid,agent,prompt,'queued',int(time.time())))
    return jid

def log_event(db, tipo: str, empresa: str | None = None, recurso: str | None = None, detalhe: str | None = None, ator: str = 'proprietario'):
    db.execute('INSERT INTO eventos(ts,empresa,ator,tipo,recurso,detalhe) VALUES(?,?,?,?,?,?)',
               (int(time.time()),empresa,ator,tipo,recurso,detalhe))

@app.post('/jobs', status_code=201, dependencies=[Depends(user_auth)])
def submit(job: NewJob):
    with connection() as db:
        jid = enqueue(db, job.agent, job.prompt)
    return {'id':jid, 'status':'queued'}

@app.get('/jobs', dependencies=[Depends(user_auth)])
def list_jobs():
    with connection() as db:
        return {'jobs':[dict(r) for r in db.execute('SELECT id,agent,status,created_at,attempts FROM jobs ORDER BY created_at DESC LIMIT 50')]}

@app.get('/jobs/{jid}', dependencies=[Depends(user_auth)])
def get_job(jid: str):
    with connection() as db:
        r=db.execute('SELECT id,agent,status,result,created_at,attempts FROM jobs WHERE id=?',(jid,)).fetchone()
    if not r: raise HTTPException(404,'Não encontrado')
    return dict(r)

@app.post('/worker/claim', dependencies=[Depends(worker_auth)])
def claim(worker_id: str = 'home'):
    if not worker_id or len(worker_id)>100: raise HTTPException(422,'worker_id inválido')
    now=int(time.time())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        # Retentativa limitada; evita ciclos infinitos de tarefas que falharam
        db.execute("UPDATE jobs SET status='queued', worker_id=NULL WHERE status='running' AND lease_until<? AND attempts<3",(now,))
        db.execute("UPDATE jobs SET status='failed', result='Worker expirou 3 vezes' WHERE status='running' AND lease_until<? AND attempts>=3",(now,))
        r=db.execute("SELECT id,agent,prompt FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
        if not r: return {'job':None}
        db.execute("UPDATE jobs SET status='running',worker_id=?,lease_until=?,attempts=attempts+1 WHERE id=?",(worker_id,now+LEASE_SECONDS,r['id']))
        return {'job':dict(r, system=office.system_prompt(r['agent']))}

@app.post('/worker/jobs/{jid}/complete', dependencies=[Depends(worker_auth)])
def complete(jid: str, payload: Result):
    with connection() as db:
        cur=db.execute("UPDATE jobs SET status=?,result=?,lease_until=NULL WHERE id=? AND status='running' AND worker_id=?",
                       ('completed' if payload.success else 'failed',payload.result,jid,payload.worker_id))
        if cur.rowcount != 1: raise HTTPException(409,'Tarefa não atribuída a este worker')
    return {'status':'ok'}


# ---------- Escritório: equipe, pendências e "o que temos para hoje" ----------

class NovaPendencia(BaseModel):
    empresa: str = Field(min_length=1, max_length=40)
    categoria: Literal[tuple(office.CATEGORIAS)]
    titulo: str = Field(min_length=3, max_length=200)
    detalhe: str | None = Field(None, max_length=4000)
    cliente: str | None = Field(None, max_length=200)
    prazo: str | None = None
    agente: AgentKey | None = None

    @field_validator('prazo')
    @classmethod
    def _prazo(cls, v):
        if v in (None, ''):
            return None
        date.fromisoformat(v)
        return v

class AtualizaPendencia(BaseModel):
    status: Literal['aberta', 'delegada', 'concluida', 'cancelada']

def empresas_db(db) -> dict:
    return {r['chave']: r['nome'] for r in db.execute('SELECT chave,nome FROM empresas ORDER BY rowid')}

def get_pendencia(db, pid: str) -> dict:
    r = db.execute('SELECT * FROM pendencias WHERE id=?', (pid,)).fetchone()
    if not r: raise HTTPException(404, 'Não encontrado')
    return dict(r)

@app.get('/equipe', dependencies=[Depends(user_auth)])
def equipe():
    with connection() as db:
        emps = empresas_db(db)
    return {
        'empresas': [{'chave': k, 'nome': v} for k, v in emps.items()],
        'agentes': [{'chave': k, 'nome': n, 'departamento': d} for k, (n, d, _) in office.AGENTES.items()],
        'categorias': [{'chave': k, 'nome': n, 'agente': a} for k, (n, a) in office.CATEGORIAS.items()],
    }

@app.get('/pendencias', dependencies=[Depends(user_auth)])
def listar_pendencias(empresa: str | None = None, abertas: bool = True):
    q, args = 'SELECT * FROM pendencias WHERE 1=1', []
    if empresa:
        q += ' AND empresa=?'; args.append(empresa)
    if abertas:
        q += " AND status IN ('aberta','delegada')"
    q += ' ORDER BY created_at DESC LIMIT 500'
    with connection() as db:
        return {'pendencias': [dict(r) for r in db.execute(q, args)]}

@app.post('/pendencias', status_code=201, dependencies=[Depends(user_auth)])
def criar_pendencia(p: NovaPendencia):
    pid, now = str(uuid.uuid4()), int(time.time())
    agente = p.agente or office.CATEGORIAS[p.categoria][1]
    with connection() as db:
        if p.empresa not in empresas_db(db): raise HTTPException(422, 'Empresa inválida')
        db.execute('INSERT INTO pendencias(id,empresa,categoria,titulo,detalhe,cliente,prazo,status,agente,created_at,updated_at) '
                   'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (pid,p.empresa,p.categoria,p.titulo.strip(),p.detalhe,p.cliente,p.prazo,'aberta',agente,now,now))
        log_event(db, 'pendencia.criada', p.empresa, pid, p.titulo.strip())
        return get_pendencia(db, pid)

@app.get('/pendencias/{pid}', dependencies=[Depends(user_auth)])
def ver_pendencia(pid: str):
    with connection() as db:
        return get_pendencia(db, pid)

@app.patch('/pendencias/{pid}', dependencies=[Depends(user_auth)])
def atualizar_pendencia(pid: str, a: AtualizaPendencia):
    now = int(time.time())
    with connection() as db:
        p = get_pendencia(db, pid)
        db.execute('UPDATE pendencias SET status=?,updated_at=?,concluded_at=? WHERE id=?',
                   (a.status, now, now if a.status == 'concluida' else None, pid))
        log_event(db, f'pendencia.{a.status}', p['empresa'], pid)
        return get_pendencia(db, pid)

@app.post('/pendencias/{pid}/delegar', dependencies=[Depends(user_auth)])
def delegar(pid: str):
    """Cria uma tarefa para o agente responsável, com o contexto só da empresa da pendência."""
    with connection() as db:
        p = get_pendencia(db, pid)
        if p['status'] not in office.STATUS_ABERTOS: raise HTTPException(409, 'Pendência já encerrada')
        nome_emp = empresas_db(db).get(p['empresa'], p['empresa'])
        dias, motivo = office.motivo_prazo(p['prazo'], office.hoje_brt())
        prompt = '\n'.join(x for x in (
            f'Empresa: {nome_emp}', f"Tipo: {office.CATEGORIAS[p['categoria']][0]}", f"Pendência: {p['titulo']}",
            f"Cliente: {p['cliente']}" if p['cliente'] else '', f"Prazo: {p['prazo']} ({motivo})" if p['prazo'] else '',
            f"Detalhes: {p['detalhe']}" if p['detalhe'] else '',
            'Prepare as próximas ações para resolver esta pendência e o que depende de aprovação do proprietário.') if x)
        jid = enqueue(db, p['agente'], prompt)
        db.execute("UPDATE pendencias SET status='delegada',job_id=?,updated_at=? WHERE id=?", (jid, int(time.time()), pid))
        log_event(db, 'pendencia.delegada', p['empresa'], pid, f"{p['agente']}:{jid}")
    return {'job_id': jid, 'agente': p['agente']}

def _briefing(db):
    itens = [dict(r) for r in db.execute("SELECT * FROM pendencias WHERE status IN ('aberta','delegada')")]
    return office.briefing(itens, office.hoje_brt(), empresas_db(db))

@app.get('/hoje', dependencies=[Depends(user_auth)])
def hoje():
    """Modo ASSISTENTE DE TRABALHO: pendências abertas por empresa, já priorizadas. Sem IA, sem dados inventados."""
    with connection() as db:
        return _briefing(db)

@app.post('/hoje/plano', status_code=201, dependencies=[Depends(user_auth)])
def plano_do_dia():
    """Pede ao Secretário Executivo um plano de trabalho a partir do briefing."""
    with connection() as db:
        b = _briefing(db)
        if not any(e['itens'] for e in b['empresas']):
            raise HTTPException(409, 'Nenhuma pendência cadastrada para planejar')
        jid = enqueue(db, 'secretario', office.briefing_texto(b)[:6000])
        log_event(db, 'plano.solicitado', None, jid)
    return {'id': jid, 'status': 'queued'}

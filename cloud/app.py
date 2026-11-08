import os, sqlite3, secrets, time, uuid
from contextlib import contextmanager
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Literal

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

class NewJob(BaseModel):
    agent: Literal['jarvis', 'sentinel'] = 'jarvis'
    prompt: str = Field(min_length=3, max_length=6000)

class Result(BaseModel):
    worker_id: str = Field(min_length=1, max_length=100)
    result: str = Field(min_length=1, max_length=30000)
    success: bool = True

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.post('/jobs', status_code=201, dependencies=[Depends(user_auth)])
def submit(job: NewJob):
    jid = str(uuid.uuid4())
    with connection() as db:
        db.execute('INSERT INTO jobs(id,agent,prompt,status,created_at) VALUES(?,?,?,?,?)',
                   (jid,job.agent,job.prompt,'queued',int(time.time())))
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
        return {'job':dict(r)}

@app.post('/worker/jobs/{jid}/complete', dependencies=[Depends(worker_auth)])
def complete(jid: str, payload: Result):
    with connection() as db:
        cur=db.execute("UPDATE jobs SET status=?,result=?,lease_until=NULL WHERE id=? AND status='running' AND worker_id=?",
                       ('completed' if payload.success else 'failed',payload.result,jid,payload.worker_id))
        if cur.rowcount != 1: raise HTTPException(409,'Tarefa não atribuída a este worker')
    return {'status':'ok'}

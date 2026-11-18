import os, sqlite3, secrets, time, uuid, hashlib
from datetime import datetime
from contextlib import contextmanager
from datetime import date
from fastapi import FastAPI, Header, HTTPException, Depends, Query
from pydantic import BaseModel as _BaseModel, ConfigDict, Field, field_validator
from typing import Literal
import office, crm, knowledge, access
from access import Ator
from collections import defaultdict, deque
from fastapi import Request
from fastapi.responses import JSONResponse


class BaseModel(_BaseModel):
    # Bloqueia mass assignment: campo não previsto = 422.
    model_config = ConfigDict(extra='forbid')

DB = os.getenv('JARVIS_DB', '/data/jarvis.sqlite3')
USER_KEY = os.getenv('JARVIS_USER_KEY', '')
WORKER_KEY = os.getenv('JARVIS_WORKER_KEY', '')
LEASE_SECONDS = 300
app = FastAPI(title='JARVIS Cloud Queue', docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware('http')
async def security_headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:  # nunca devolve stack trace
        response = JSONResponse({'detail': 'Erro interno'}, status_code=500)
    for k, v in (('X-Content-Type-Options', 'nosniff'), ('X-Frame-Options', 'DENY'), ('Cache-Control', 'no-store'),
                 ('Referrer-Policy', 'no-referrer'), ('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")):
        response.headers[k] = v
    return response

# Limite simples por usuário nas rotas que acionam IA (instância única da API).
RATE_MAX, RATE_JANELA = int(os.getenv('JARVIS_RATE_MAX', '40')), 600
_rate: dict[str, deque] = defaultdict(deque)

def limitar_ia(quem: str):
    agora, fila = time.time(), _rate[quem]
    while fila and agora - fila[0] > RATE_JANELA:
        fila.popleft()
    if len(fila) >= RATE_MAX:
        raise HTTPException(429, 'Muitas solicitações. Aguarde alguns minutos.')
    fila.append(agora)

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
        conn.execute(knowledge.SCHEMA)
        cols = {r[1] for r in conn.execute('PRAGMA table_info(jobs)')}
        if 'empresa' not in cols: conn.execute('ALTER TABLE jobs ADD COLUMN empresa TEXT')
        if 'contexto' not in cols: conn.execute('ALTER TABLE jobs ADD COLUMN contexto TEXT')
        if 'usuario' not in cols: conn.execute('ALTER TABLE jobs ADD COLUMN usuario TEXT')
        conn.execute(access.SCHEMA_USUARIOS)
        conn.execute(access.SCHEMA_ACESSOS)
        conn.execute('CREATE TABLE IF NOT EXISTS crm_delegacoes (item_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, ts INTEGER NOT NULL)')
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

def ator(x_api_key: str | None = Header(None), x_jarvis_user: str | None = Header(None)) -> Ator:
    """Identidade de quem pede. Sem cabeçalho: proprietário. Com cabeçalho: membro ativo, com seus acessos."""
    require_key(x_api_key, USER_KEY)
    if not x_jarvis_user:
        return access.DONO
    if not access.UUID_RE.match(x_jarvis_user):
        raise HTTPException(403, 'Usuário inválido')
    uid = x_jarvis_user.lower()
    with connection() as db:
        u = db.execute('SELECT ativo FROM usuarios WHERE id=?', (uid,)).fetchone()
        if not u or not u['ativo']:
            log_event(db, 'acesso.negado', None, 'login', 'revogado' if u else 'nao_cadastrado', ator=uid)
            db.commit()
            raise HTTPException(403, 'Usuário sem acesso ao JARVIS')
        perms: dict[str, set[str]] = {}
        for r in db.execute('SELECT empresa,modulo FROM acessos WHERE usuario_id=?', (uid,)):
            perms.setdefault(r['empresa'], set()).add(r['modulo'])
        db.execute('UPDATE usuarios SET ultimo_acesso=? WHERE id=?', (int(time.time()), uid))
    return Ator(uid, False, perms)

def registrar_negado(a: Ator, empresa: str | None, recurso: str):
    """Auditoria de tentativa negada. Conexão própria e curta: nunca trava nem derruba a resposta 403."""
    try:
        conn = sqlite3.connect(DB, timeout=2)
        try:
            log_event(conn, 'acesso.negado', empresa, recurso, ator=a.id)
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error:
        pass

def exigir(a: Ator, empresa: str | None, modulo: str):
    if not a.pode(empresa, modulo):
        registrar_negado(a, empresa, modulo)
        raise HTTPException(403, 'Sem permissão para esta empresa')

def worker_auth(x_worker_key: str | None = Header(None)):
    require_key(x_worker_key, WORKER_KEY)

AgentKey = Literal[tuple(office.AGENTES)]

class NewJob(BaseModel):
    agent: AgentKey = 'jarvis'
    prompt: str = Field(min_length=3, max_length=6000)
    empresa: str | None = Field(None, max_length=40)

class Result(BaseModel):
    worker_id: str = Field(min_length=1, max_length=100)
    result: str = Field(min_length=1, max_length=30000)
    success: bool = True

@app.get('/health')
def health():
    return {'status': 'ok'}

def regras_confirmadas(db, empresas: list[str]) -> dict:
    nomes = empresas_db(db)
    return {e: (nomes.get(e, e), [dict(r) for r in db.execute(
        "SELECT assunto,texto,updated_at FROM conhecimento WHERE empresa=? AND estado='confirmada'", (e,))])
        for e in empresas}

def enqueue(db, agent: str, prompt: str, empresas: list[str] | None = None, categoria: str | None = None, usuario: str = 'proprietario') -> str:
    """Cria a tarefa. O contexto (regras confirmadas) é fotografado agora, só das empresas da tarefa."""
    limitar_ia(usuario)
    jid = str(uuid.uuid4())
    ctx = knowledge.contexto(regras_confirmadas(db, empresas), categoria) if empresas else ''
    db.execute('INSERT INTO jobs(id,agent,prompt,status,created_at,empresa,contexto,usuario) VALUES(?,?,?,?,?,?,?,?)',
               (jid,agent,prompt,'queued',int(time.time()),','.join(empresas or []) or None,ctx or None,usuario))
    return jid

def log_event(db, tipo: str, empresa: str | None = None, recurso: str | None = None, detalhe: str | None = None, ator: str = 'proprietario'):
    db.execute('INSERT INTO eventos(ts,empresa,ator,tipo,recurso,detalhe) VALUES(?,?,?,?,?,?)',
               (int(time.time()),empresa,ator,tipo,recurso,detalhe))

@app.post('/jobs', status_code=201)
def submit(job: NewJob, a: Ator = Depends(ator)):
    with connection() as db:
        if job.empresa and job.empresa not in empresas_db(db): raise HTTPException(422, 'Empresa inválida')
        if job.empresa: exigir(a, job.empresa, 'delegar')
        elif not a.alguma('delegar'): raise HTTPException(403, 'Sem permissão para criar tarefas')
        if not a.dono and job.agent in ('programador', 'sentinel'):
            raise HTTPException(403, 'Equipe técnica só para o proprietário')
        jid = enqueue(db, job.agent, job.prompt, [job.empresa] if job.empresa else None, usuario=a.id)
        log_event(db, 'tarefa.criada', job.empresa, jid, job.agent, ator=a.id)
    return {'id':jid, 'status':'queued'}

@app.get('/jobs')
def list_jobs(a: Ator = Depends(ator)):
    """Proprietário vê todas; membro vê só as próprias."""
    q = 'SELECT id,agent,status,created_at,attempts,empresa FROM jobs'
    args: tuple = ()
    if not a.dono:
        q += ' WHERE usuario=?'; args = (a.id,)
    with connection() as db:
        return {'jobs':[dict(r) for r in db.execute(q + ' ORDER BY created_at DESC LIMIT 50', args)]}

@app.get('/jobs/{jid}')
def get_job(jid: str, a: Ator = Depends(ator)):
    with connection() as db:
        r=db.execute('SELECT id,agent,status,result,created_at,attempts,empresa,contexto,usuario FROM jobs WHERE id=?',(jid,)).fetchone()
    if not r or (not a.dono and r['usuario'] != a.id): raise HTTPException(404,'Não encontrado')
    return {k: r[k] for k in r.keys() if k != 'usuario'}

@app.post('/worker/claim', dependencies=[Depends(worker_auth)])
def claim(worker_id: str = 'home'):
    if not worker_id or len(worker_id)>100: raise HTTPException(422,'worker_id inválido')
    now=int(time.time())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        # Retentativa limitada; evita ciclos infinitos de tarefas que falharam
        db.execute("UPDATE jobs SET status='queued', worker_id=NULL WHERE status='running' AND lease_until<? AND attempts<3",(now,))
        db.execute("UPDATE jobs SET status='failed', result='Worker expirou 3 vezes' WHERE status='running' AND lease_until<? AND attempts>=3",(now,))
        r=db.execute("SELECT id,agent,prompt,contexto FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
        if not r: return {'job':None}
        db.execute("UPDATE jobs SET status='running',worker_id=?,lease_until=?,attempts=attempts+1 WHERE id=?",(worker_id,now+LEASE_SECONDS,r['id']))
        job = {'id': r['id'], 'agent': r['agent'], 'prompt': r['prompt'], 'system': office.system_prompt(r['agent'])}
        if r['contexto']:
            job['system'] += '\n\n' + r['contexto']
        return {'job': job}

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

@app.get('/equipe')
def equipe(a: Ator = Depends(ator)):
    with connection() as db:
        todas = empresas_db(db)
    emps = todas if a.dono else {k: v for k, v in todas.items() if a.perms.get(k)}
    return {
        'empresas': [{'chave': k, 'nome': v} for k, v in emps.items()],
        'agentes': [{'chave': k, 'nome': n, 'departamento': d} for k, (n, d, _) in office.AGENTES.items()],
        'categorias': [{'chave': k, 'nome': n, 'agente': a} for k, (n, a) in office.CATEGORIAS.items()],
    }

@app.get('/pendencias')
def listar_pendencias(empresa: str | None = None, abertas: bool = True, a: Ator = Depends(ator)):
    q, args = 'SELECT * FROM pendencias WHERE 1=1', []
    if empresa:
        exigir(a, empresa, 'hoje')
        q += ' AND empresa=?'; args.append(empresa)
    elif not a.dono:
        permitidas = [e for e, m in a.perms.items() if 'hoje' in m] or ['-']
        q += f" AND empresa IN ({','.join('?' * len(permitidas))})"; args += permitidas
    if abertas:
        q += " AND status IN ('aberta','delegada')"
    q += ' ORDER BY created_at DESC LIMIT 500'
    with connection() as db:
        return {'pendencias': [dict(r) for r in db.execute(q, args)]}

@app.post('/pendencias', status_code=201)
def criar_pendencia(p: NovaPendencia, a: Ator = Depends(ator)):
    pid, now = str(uuid.uuid4()), int(time.time())
    agente = p.agente or office.CATEGORIAS[p.categoria][1]
    with connection() as db:
        if p.empresa not in empresas_db(db): raise HTTPException(422, 'Empresa inválida')
        exigir(a, p.empresa, 'pendencias')
        db.execute('INSERT INTO pendencias(id,empresa,categoria,titulo,detalhe,cliente,prazo,status,agente,created_at,updated_at) '
                   'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (pid,p.empresa,p.categoria,p.titulo.strip(),p.detalhe,p.cliente,p.prazo,'aberta',agente,now,now))
        log_event(db, 'pendencia.criada', p.empresa, pid, p.titulo.strip(), ator=a.id)
        return get_pendencia(db, pid)

def pendencia_visivel(db, pid: str, a: Ator, modulo: str) -> dict:
    p = get_pendencia(db, pid)
    if not a.pode(p['empresa'], modulo):
        registrar_negado(a, p['empresa'], f"{modulo}:{p['id']}")
        if not a.pode(p['empresa'], 'hoje'): raise HTTPException(404, 'Não encontrado')  # não revela que existe
        raise HTTPException(403, 'Sem permissão para esta empresa')
    return p

@app.get('/pendencias/{pid}')
def ver_pendencia(pid: str, a: Ator = Depends(ator)):
    with connection() as db:
        return pendencia_visivel(db, pid, a, 'hoje')

@app.patch('/pendencias/{pid}')
def atualizar_pendencia(pid: str, u: AtualizaPendencia, a: Ator = Depends(ator)):
    now = int(time.time())
    with connection() as db:
        p = pendencia_visivel(db, pid, a, 'pendencias')
        db.execute('UPDATE pendencias SET status=?,updated_at=?,concluded_at=? WHERE id=?',
                   (u.status, now, now if u.status == 'concluida' else None, pid))
        log_event(db, f'pendencia.{u.status}', p['empresa'], pid, ator=a.id)
        return get_pendencia(db, pid)

@app.post('/pendencias/{pid}/delegar')
def delegar(pid: str, a: Ator = Depends(ator)):
    """Cria uma tarefa para o agente responsável, com o contexto só da empresa da pendência."""
    with connection() as db:
        p = pendencia_visivel(db, pid, a, 'delegar')
        if p['status'] not in office.STATUS_ABERTOS: raise HTTPException(409, 'Pendência já encerrada')
        nome_emp = empresas_db(db).get(p['empresa'], p['empresa'])
        dias, motivo = office.motivo_prazo(p['prazo'], office.hoje_brt())
        prompt = '\n'.join(x for x in (
            f'Empresa: {nome_emp}', f"Tipo: {office.CATEGORIAS[p['categoria']][0]}", f"Pendência: {p['titulo']}",
            f"Cliente: {p['cliente']}" if p['cliente'] else '', f"Prazo: {p['prazo']} ({motivo})" if p['prazo'] else '',
            f"Detalhes: {p['detalhe']}" if p['detalhe'] else '',
            'Prepare as próximas ações para resolver esta pendência e o que depende de aprovação do proprietário.') if x)
        jid = enqueue(db, p['agente'], prompt, [p['empresa']], p['categoria'], usuario=a.id)
        db.execute("UPDATE pendencias SET status='delegada',job_id=?,updated_at=? WHERE id=?", (jid, int(time.time()), pid))
        log_event(db, 'pendencia.delegada', p['empresa'], pid, f"{p['agente']}:{jid}", ator=a.id)
    return {'job_id': jid, 'agente': p['agente']}

def _crm_itens(db) -> tuple[list[dict], dict]:
    """Pendências reais do CRM Bielenki (Marquinhos). Falha do CRM não derruba o briefing."""
    fonte = {'nome': 'CRM Bielenki', 'empresa': crm.EMPRESA, 'ok': False, 'erro': None}
    if not crm.configurado():
        fonte['erro'] = 'Conector não configurado'
        return [], fonte
    try:
        raw = crm.buscar_pendencias()
    except crm.CrmError as e:
        fonte['erro'] = str(e)
        return [], fonte
    delegadas = {r['item_id']: r['job_id'] for r in db.execute('SELECT item_id,job_id FROM crm_delegacoes')}
    fonte['ok'] = True
    return crm.para_pendencias(raw, delegadas), fonte

def _briefing(db, a: Ator):
    """Só empresas que o usuário pode ver; o CRM da Marquinhos nem é consultado sem permissão."""
    emps = a.empresas('hoje', empresas_db(db))
    itens = [dict(r, origem='jarvis') for r in db.execute("SELECT * FROM pendencias WHERE status IN ('aberta','delegada')")
             if r['empresa'] in emps]
    fontes = []
    if crm.EMPRESA in emps:
        itens_crm, fonte = _crm_itens(db)
        itens += itens_crm; fontes.append(fonte)
    b = office.briefing(itens, office.hoje_brt(), emps)
    b['fontes'] = fontes
    return b

class DelegarCrm(BaseModel):
    id: str = Field(min_length=5, max_length=120, pattern=r'^crm:[a-z_]+:[0-9a-fA-F-]{36}$')

@app.post('/crm/delegar')
def delegar_crm(d: DelegarCrm, a: Ator = Depends(ator)):
    """Delega um item do CRM. O conteúdo vem do CRM, não do navegador."""
    exigir(a, crm.EMPRESA, 'delegar')
    with connection() as db:
        itens, fonte = _crm_itens(db)
        if not fonte['ok']: raise HTTPException(409, f"CRM indisponível: {fonte['erro']}")
        p = next((i for i in itens if i['id'] == d.id), None)
        if not p: raise HTTPException(404, 'Não encontrado')
        _, motivo = office.motivo_prazo(p['prazo'], office.hoje_brt())
        prompt = '\n'.join(x for x in (
            f"Empresa: {office.EMPRESAS[crm.EMPRESA]} (dados do CRM Bielenki)",
            f"Tipo: {office.CATEGORIAS[p['categoria']][0]}", f"Pendência: {p['titulo']}",
            f"Situação: {p['detalhe']}" if p['detalhe'] else '', f"Cliente: {p['cliente']}" if p['cliente'] else '',
            f"Valor: R$ {p['valor']}" if p['valor'] is not None else '',
            f"Prazo: {p['prazo']} ({motivo})" if p['prazo'] else '',
            'Prepare as próximas ações para resolver esta pendência e o que depende de aprovação do proprietário. '
            'Mensagens a clientes devem ser rascunhos.') if x)
        jid = enqueue(db, p['agente'], prompt, [crm.EMPRESA], p['categoria'], usuario=a.id)
        db.execute('INSERT OR REPLACE INTO crm_delegacoes(item_id,job_id,ts) VALUES(?,?,?)', (d.id, jid, int(time.time())))
        log_event(db, 'crm.delegada', crm.EMPRESA, d.id, f"{p['agente']}:{jid}", ator=a.id)
    return {'job_id': jid, 'agente': p['agente']}

@app.get('/crm/lia')
def lia_status(a: Ator = Depends(ator)):
    """Como está a Lia no atendimento do WhatsApp (CRM). Só leitura; ação continua no CRM."""
    exigir(a, crm.EMPRESA, 'atendimento')
    try:
        return crm.buscar_lia()
    except crm.CrmError as e:
        raise HTTPException(503, f'CRM indisponível: {e}') from None

@app.get('/crm/clientes')
def crm_clientes(q: str = Query(min_length=2, max_length=120), a: Ator = Depends(ator)):
    """Busca de cliente no CRM para agendar. Só leitura, com as permissões do usuário JARVIS no CRM."""
    exigir(a, crm.EMPRESA, 'agenda')
    try:
        return {'clientes': crm.buscar_clientes(q)}
    except crm.CrmRecusa as e:
        raise HTTPException(409, str(e)) from None
    except crm.CrmError as e:
        raise HTTPException(503, f'CRM indisponível: {e}') from None

class Medicao(BaseModel):
    cliente_id: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')
    quando: datetime
    obs: str | None = Field(None, max_length=500)

@app.post('/crm/medicao', status_code=201)
def crm_medicao(m: Medicao, a: Ator = Depends(ator)):
    """Agenda medição no CRM (ação confirmada pelo usuário). Mesmo pedido repetido não duplica."""
    exigir(a, crm.EMPRESA, 'agenda')
    if m.quando.tzinfo is None: raise HTTPException(422, 'Informe o fuso horário')
    quando = m.quando.isoformat()
    pedido = 'jv-' + hashlib.sha256(f'{a.id}|{m.cliente_id.lower()}|{quando}'.encode()).hexdigest()[:32]
    try:
        r = crm.agendar_medicao(pedido, m.cliente_id.lower(), quando, (m.obs or '').strip() or None)
    except crm.CrmRecusa as e:
        raise HTTPException(409, str(e)) from None
    except crm.CrmError as e:
        raise HTTPException(503, f'CRM indisponível: {e}') from None
    with connection() as db:
        log_event(db, 'crm.medicao_agendada', crm.EMPRESA, r['id'], f"{r['cliente']} {r['quando']}{' (já existia)' if r['ja_existia'] else ''}", ator=a.id)
    crm.limpar_cache()
    return r

@app.get('/hoje')
def hoje(a: Ator = Depends(ator)):
    """Modo ASSISTENTE DE TRABALHO: pendências abertas por empresa, já priorizadas. Sem IA, sem dados inventados."""
    with connection() as db:
        return _briefing(db, a)

@app.post('/hoje/plano', status_code=201)
def plano_do_dia(a: Ator = Depends(ator)):
    """Pede ao Secretário Executivo um plano de trabalho a partir do briefing (só empresas em que pode delegar)."""
    with connection() as db:
        b = _briefing(db, a)
        b['empresas'] = [e for e in b['empresas'] if a.pode(e['empresa'], 'delegar')]
        if not any(e['itens'] for e in b['empresas']):
            raise HTTPException(409, 'Nenhuma pendência cadastrada para planejar')
        jid = enqueue(db, 'secretario', office.briefing_texto(b)[:6000], [e['empresa'] for e in b['empresas'] if e['itens']], usuario=a.id)
        log_event(db, 'plano.solicitado', None, jid, ator=a.id)
    return {'id': jid, 'status': 'queued'}


# ---------- Central de Conhecimento Empresarial ----------

class NovaRegra(BaseModel):
    empresa: str = Field(min_length=1, max_length=40)
    assunto: Literal[tuple(knowledge.ASSUNTOS)]
    texto: str = Field(min_length=5, max_length=1000)
    estado: Literal['provisoria', 'hipotese', 'sugestao'] = 'provisoria'
    fonte: str | None = Field(None, max_length=200)

class EditaRegra(BaseModel):
    texto: str = Field(min_length=5, max_length=1000)
    fonte: str | None = Field(None, max_length=200)

def get_regra(db, rid: str, a: Ator | None = None, modulo: str = 'conhecimento') -> dict:
    r = db.execute('SELECT * FROM conhecimento WHERE id=?', (rid,)).fetchone()
    if not r: raise HTTPException(404, 'Não encontrado')
    if a is not None and not a.pode(r['empresa'], modulo):
        registrar_negado(a, r['empresa'], f"{modulo}:{r['id']}")
        if not a.pode(r['empresa'], 'conhecimento'): raise HTTPException(404, 'Não encontrado')
        raise HTTPException(403, 'Sem permissão para esta empresa')
    return dict(r)

def regras_ativas(db, empresa: str) -> list[dict]:
    return [dict(r) for r in db.execute(
        f"SELECT * FROM conhecimento WHERE empresa=? AND estado IN {knowledge.ATIVOS} ORDER BY assunto, updated_at DESC", (empresa,))]

@app.get('/conhecimento')
def listar_conhecimento(empresa: str, a: Ator = Depends(ator)):
    with connection() as db:
        if empresa not in empresas_db(db): raise HTTPException(422, 'Empresa inválida')
        exigir(a, empresa, 'conhecimento')
        return {'regras': regras_ativas(db, empresa), 'assuntos': knowledge.ASSUNTOS}

@app.post('/conhecimento', status_code=201)
def criar_regra(n: NovaRegra, a: Ator = Depends(ator)):
    """Toda regra nova entra pendente de confirmação e informa regras parecidas (duplicata/conflito)."""
    rid, now = str(uuid.uuid4()), int(time.time())
    with connection() as db:
        if n.empresa not in empresas_db(db): raise HTTPException(422, 'Empresa inválida')
        exigir(a, n.empresa, 'conhecimento_editar')
        parecidas = knowledge.semelhantes(n.texto, regras_ativas(db, n.empresa))
        db.execute('INSERT INTO conhecimento(id,empresa,assunto,texto,estado,fonte,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                   (rid, n.empresa, n.assunto, n.texto.strip(), n.estado, n.fonte, now, now))
        log_event(db, 'conhecimento.criada', n.empresa, rid, n.estado, ator=a.id)
        return {'regra': get_regra(db, rid), 'semelhantes': parecidas}

@app.post('/conhecimento/{rid}/confirmar')
def confirmar_regra(rid: str, a: Ator = Depends(ator)):
    with connection() as db:
        r = get_regra(db, rid, a, 'conhecimento_aprovar')
        if r['estado'] not in ('provisoria', 'hipotese', 'sugestao'): raise HTTPException(409, 'Regra não está pendente')
        now = int(time.time())
        db.execute("UPDATE conhecimento SET estado='confirmada',confirmado_em=?,updated_at=? WHERE id=?", (now, now, rid))
        ant, vistos = r['anterior_id'], set()
        while ant and ant not in vistos:  # versões anteriores confirmadas deixam de valer
            vistos.add(ant)
            db.execute("UPDATE conhecimento SET estado='substituida',updated_at=? WHERE id=? AND estado='confirmada'", (now, ant))
            row = db.execute('SELECT anterior_id FROM conhecimento WHERE id=?', (ant,)).fetchone()
            ant = row['anterior_id'] if row else None
        log_event(db, 'conhecimento.confirmada', r['empresa'], rid, f"v{r['versao']}", ator=a.id)
        return get_regra(db, rid)

@app.post('/conhecimento/{rid}/editar', status_code=201)
def editar_regra(rid: str, e: EditaRegra, a: Ator = Depends(ator)):
    """Nunca sobrescreve: cria nova versão provisória. A anterior segue valendo até a nova ser confirmada."""
    with connection() as db:
        r = get_regra(db, rid, a, 'conhecimento_editar')
        if r['estado'] not in knowledge.ATIVOS: raise HTTPException(409, 'Regra inativa')
        nid, now = str(uuid.uuid4()), int(time.time())
        db.execute('INSERT INTO conhecimento(id,empresa,assunto,texto,estado,fonte,versao,anterior_id,created_at,updated_at) '
                   'VALUES(?,?,?,?,?,?,?,?,?,?)',
                   (nid, r['empresa'], r['assunto'], e.texto.strip(), 'provisoria', e.fonte or r['fonte'], r['versao'] + 1, rid, now, now))
        if r['estado'] != 'confirmada':
            db.execute("UPDATE conhecimento SET estado='substituida',updated_at=? WHERE id=?", (now, rid))
        log_event(db, 'conhecimento.editada', r['empresa'], nid, f"de {rid}", ator=a.id)
        return get_regra(db, nid)

@app.post('/conhecimento/{rid}/arquivar')
def arquivar_regra(rid: str, a: Ator = Depends(ator)):
    with connection() as db:
        r = get_regra(db, rid, a, 'conhecimento_aprovar')
        db.execute("UPDATE conhecimento SET estado='arquivada',updated_at=? WHERE id=?", (int(time.time()), rid))
        log_event(db, 'conhecimento.arquivada', r['empresa'], rid, ator=a.id)
        return get_regra(db, rid)


# ---------- Usuários e permissões (só o proprietário administra) ----------

class Membro(BaseModel):
    id: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')
    email: str = Field(min_length=3, max_length=200)
    nome: str | None = Field(None, max_length=120)
    cargo: str | None = Field(None, max_length=80)
    acessos: dict[str, list[Literal[tuple(access.MODULOS)]]] = {}

def so_dono(a: Ator):
    if not a.dono:
        registrar_negado(a, None, 'usuarios')
        raise HTTPException(403, 'Só o proprietário gerencia usuários')

def membro_dict(db, uid: str) -> dict:
    u = db.execute('SELECT * FROM usuarios WHERE id=?', (uid,)).fetchone()
    if not u: raise HTTPException(404, 'Não encontrado')
    acc: dict[str, list[str]] = {}
    for r in db.execute('SELECT empresa,modulo FROM acessos WHERE usuario_id=? ORDER BY empresa,modulo', (uid,)):
        acc.setdefault(r['empresa'], []).append(r['modulo'])
    return dict(u, ativo=bool(u['ativo']), acessos=acc)

@app.get('/me')
def me(a: Ator = Depends(ator)):
    with connection() as db:
        todas = empresas_db(db)
    return {'id': a.id, 'proprietario': a.dono,
            'acessos': {e: sorted(access.MODULOS) for e in todas} if a.dono else {e: sorted(m) for e, m in a.perms.items()},
            'modulos': access.MODULOS}

@app.get('/usuarios')
def listar_usuarios(a: Ator = Depends(ator)):
    so_dono(a)
    with connection() as db:
        return {'usuarios': [membro_dict(db, r['id']) for r in db.execute('SELECT id FROM usuarios ORDER BY created_at')],
                'modulos': access.MODULOS, 'empresas': empresas_db(db)}

@app.put('/usuarios/{uid}')
def salvar_usuario(uid: str, m: Membro, a: Ator = Depends(ator)):
    """Cria ou atualiza um membro e substitui todos os acessos dele (o que não vier, perde)."""
    so_dono(a)
    if uid.lower() != m.id.lower() or not access.UUID_RE.match(uid): raise HTTPException(422, 'Id inválido')
    uid, now = uid.lower(), int(time.time())
    with connection() as db:
        emps = empresas_db(db)
        if any(e not in emps for e in m.acessos): raise HTTPException(422, 'Empresa inválida')
        db.execute('INSERT INTO usuarios(id,email,nome,cargo,ativo,created_at,updated_at) VALUES(?,?,?,?,1,?,?) '
                   'ON CONFLICT(id) DO UPDATE SET email=excluded.email,nome=excluded.nome,cargo=excluded.cargo,updated_at=excluded.updated_at',
                   (uid, m.email.strip(), m.nome, m.cargo, now, now))
        db.execute('DELETE FROM acessos WHERE usuario_id=?', (uid,))
        db.executemany('INSERT INTO acessos(usuario_id,empresa,modulo) VALUES(?,?,?)',
                       [(uid, e, mod) for e, mods in m.acessos.items() for mod in set(mods)])
        log_event(db, 'usuario.acessos', None, uid, ';'.join(f"{e}:{','.join(sorted(set(v)))}" for e, v in m.acessos.items()), ator=a.id)
        return membro_dict(db, uid)

@app.post('/usuarios/{uid}/ativo')
def ativar_usuario(uid: str, ativo: bool, a: Ator = Depends(ator)):
    """Revoga (ou devolve) o acesso imediatamente, sem apagar o histórico."""
    so_dono(a)
    with connection() as db:
        membro_dict(db, uid.lower())
        db.execute('UPDATE usuarios SET ativo=?,updated_at=? WHERE id=?', (1 if ativo else 0, int(time.time()), uid.lower()))
        log_event(db, 'usuario.ativado' if ativo else 'usuario.revogado', None, uid.lower(), ator=a.id)
        return membro_dict(db, uid.lower())

@app.get('/auditoria')
def auditoria(empresa: str | None = None, tipo: str | None = None, limite: int = 200, a: Ator = Depends(ator)):
    """Quem fez o quê, em qual empresa, e as tentativas negadas. Só o proprietário."""
    so_dono(a)
    conds, args = [], []
    if empresa: conds.append('empresa=?'); args.append(empresa)
    if tipo: conds.append('tipo LIKE ?'); args.append(tipo.rstrip('*') + '%')
    q = 'SELECT * FROM eventos' + (' WHERE ' + ' AND '.join(conds) if conds else '')
    with connection() as db:
        nomes = {r['id']: r['nome'] or r['email'] for r in db.execute('SELECT id,nome,email FROM usuarios')}
        evs = [dict(r) for r in db.execute(q + ' ORDER BY id DESC LIMIT ?', (*args, max(1, min(limite, 500))))]
    for e in evs: e['ator_nome'] = 'Proprietário' if e['ator'] == 'proprietario' else nomes.get(e['ator'], e['ator'])
    return {'eventos': evs}

"""Conector somente leitura do CRM Bielenki (Marquinhos Calhas e Esquadrias).

Entra no Supabase do CRM com um usuário próprio do JARVIS e chama a RPC `pending_center`,
a mesma da Central de Pendências do CRM. O RLS e a empresa do usuário valem como no CRM:
o JARVIS não usa service_role e não enxerga nada além do que esse usuário enxerga.
"""
import json, os, time, urllib.error, urllib.request

EMPRESA = 'marquinhos'
URL = os.getenv('CRM_SUPABASE_URL', '').rstrip('/')
ANON = os.getenv('CRM_SUPABASE_ANON_KEY', '')
EMAIL = os.getenv('CRM_JARVIS_EMAIL', '')
PASSWORD = os.getenv('CRM_JARVIS_PASSWORD', '')
SITE = os.getenv('CRM_SITE_URL', '').rstrip('/')
CACHE_SECONDS = 60

# Categoria do CRM -> (categoria do JARVIS, agente responsável)
MAPA = {
    'orcamento': ('cliente_retorno', 'comercial'),
    'financeiro_receber': ('financeiro', 'financeiro'),
    'financeiro_pagar': ('financeiro', 'financeiro'),
    'producao': ('producao', 'producao'),
    'compra': ('compra', 'compras'),
    'instalacao': ('instalacao', 'instalacoes'),
    'medicao': ('prazo', 'producao'),
}


class CrmError(Exception):
    pass


class CrmRecusa(CrmError):
    """O CRM recusou por regra de negócio ou permissão. A mensagem é do próprio CRM e pode ser mostrada."""


_token = {'value': '', 'exp': 0.0}
_cache = {'items': None, 'ts': 0.0}


def configurado() -> bool:
    return bool(URL.startswith('https://') and ANON and EMAIL and PASSWORD)


def _post(path: str, body: dict, token: str | None = None):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(), method='POST', headers={
        'apikey': ANON, 'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token or ANON)})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try:
            b = json.loads(e.read() or b'null')
        except (ValueError, OSError):
            b = None
        if isinstance(b, dict) and b.get('code') in ('P0001', '42501') and isinstance(b.get('message'), str):
            raise CrmRecusa(b['message'][:200]) from None
        raise CrmError(f'CRM respondeu {e.code}') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CrmError('CRM indisponível') from None


def _login() -> str:
    if _token['value'] and time.time() < _token['exp'] - 60:
        return _token['value']
    data = _post('/auth/v1/token?grant_type=password', {'email': EMAIL, 'password': PASSWORD})
    if not isinstance(data, dict) or not data.get('access_token'):
        raise CrmError('Login do JARVIS no CRM falhou')
    _token.update(value=data['access_token'], exp=time.time() + int(data.get('expires_in', 3600)))
    return _token['value']


def buscar_pendencias(fetch=None) -> list[dict]:
    """Itens crus de `pending_center`, com cache curto. `fetch` permite injetar dados nos testes."""
    if _cache['items'] is not None and time.time() - _cache['ts'] < CACHE_SECONDS:
        return _cache['items']
    if fetch is None:
        if not configurado():
            raise CrmError('Conector do CRM não configurado')
        try:
            items = _post('/rest/v1/rpc/pending_center', {}, _login())
        except CrmError as e:
            if 'respondeu 401' in str(e):  # token expirado/revogado: tenta uma vez de novo
                _token['value'] = ''
                items = _post('/rest/v1/rpc/pending_center', {}, _login())
            else:
                raise
    else:
        items = fetch()
    if not isinstance(items, list):
        raise CrmError('Resposta inesperada do CRM')
    _cache.update(items=items, ts=time.time())
    return items


def _rpc(nome: str, body: dict | None = None):
    try:
        return _post(f'/rest/v1/rpc/{nome}', body or {}, _login())
    except CrmError as e:
        if 'respondeu 401' not in str(e):
            raise
        _token['value'] = ''  # token expirado/revogado: tenta uma vez de novo
        return _post(f'/rest/v1/rpc/{nome}', body or {}, _login())


def buscar_clientes(q: str) -> list[dict]:
    """Até 5 clientes da Marquinhos por nome ou telefone (RPC `jarvis_find_clients`, permissões do usuário JARVIS)."""
    if not configurado():
        raise CrmError('Conector do CRM não configurado')
    r = _rpc('jarvis_find_clients', {'p_query': q[:120]})
    if not isinstance(r, list):
        raise CrmError('Resposta inesperada do CRM')
    return [{'id': str(c.get('id')), 'nome': str(c.get('name') or '')[:120], 'telefone': c.get('phone'),
             'endereco': ', '.join(str(x) for x in (c.get('address'), c.get('neighborhood'), c.get('city')) if x) or None}
            for c in r[:5] if isinstance(c, dict) and c.get('id')]


def agendar_medicao(pedido: str, cliente_id: str, quando_iso: str, obs: str | None) -> dict:
    """Cria a medição na agenda do CRM. Mesmo `pedido` = mesmo evento (não duplica)."""
    if not configurado():
        raise CrmError('Conector do CRM não configurado')
    r = _rpc('jarvis_schedule_measurement', {'p_request_id': pedido, 'p_client_id': cliente_id,
                                             'p_starts_at': quando_iso, 'p_notes': obs})
    if not isinstance(r, dict) or not r.get('id'):
        raise CrmError('Resposta inesperada do CRM')
    cid = str(r.get('client_id') or cliente_id)
    return {'id': str(r['id']), 'cliente_id': cid, 'cliente': str(r.get('client_name') or '')[:120],
            'quando': str(r.get('starts_at') or quando_iso), 'ja_existia': bool(r.get('ja_existia')),
            'ficha': f'{SITE}/ficha/{cid}' if SITE else None, 'agenda': f'{SITE}/agenda' if SITE else None}


def buscar_lia() -> dict:
    """Resumo da Lia (atendimento do WhatsApp) pela RPC `lia_status_center`. Só leitura."""
    if not configurado():
        raise CrmError('Conector do CRM não configurado')
    r = _rpc('lia_status_center')
    if not isinstance(r, dict):
        raise CrmError('Resposta inesperada do CRM')
    sugestoes = [s for s in (r.get('sugestoes') or []) if isinstance(s, dict)]
    return {
        'ativa': bool(r.get('ativa')),
        'modo': str(r.get('modo') or 'automatica'),
        'hoje': {str(k): int(v) for k, v in (r.get('hoje') or {}).items() if isinstance(v, (int, float))},
        'sugestoes': [{'contato': str(s.get('contato') or 'cliente')[:80], 'texto': str(s.get('texto') or '')[:200],
                       'link': f"{SITE}/atendimento?c={s.get('conversa')}" if SITE and s.get('conversa') else None} for s in sugestoes[:20]],
        'aguardando_equipe': int(r.get('aguardando_equipe') or 0),
        'falhas_24h': [str(f.get('motivo') or '')[:200] for f in (r.get('falhas_24h') or []) if isinstance(f, dict)][:5],
    }


def limpar_cache():
    _cache.update(items=None, ts=0.0)


def item_id(raw: dict) -> str:
    return f"crm:{raw.get('category')}:{raw.get('record_id')}"


def para_pendencias(items: list[dict], delegadas: dict[str, str]) -> list[dict]:
    """Converte para o formato de pendência do JARVIS. Categorias desconhecidas são ignoradas."""
    out = []
    for raw in items:
        if raw.get('category') not in MAPA or not raw.get('record_id'):
            continue
        cat, agente = MAPA[raw['category']]
        iid = item_id(raw)
        link = raw.get('link') or ''
        out.append({
            'id': iid, 'empresa': EMPRESA, 'categoria': cat, 'agente': agente,
            'titulo': str(raw.get('title') or 'Pendência do CRM')[:200],
            'detalhe': raw.get('subtitle') or None, 'cliente': raw.get('client_name') or None,
            'prazo': (raw.get('due_date') or None) and str(raw['due_date'])[:10],
            'valor': raw.get('amount'), 'prioridade': raw.get('priority'),
            'status': 'delegada' if iid in delegadas else 'crm', 'job_id': delegadas.get(iid),
            'origem': 'crm', 'link': (SITE + link) if SITE and link.startswith('/') else None,
            'created_at': 0,
        })
    return out

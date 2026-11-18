import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud'))
import crm
from test_cloud import client  # noqa: F401

U = {'X-API-Key': 'u' * 40}
W = {'X-Worker-Key': 'w' * 40}
RID = '11111111-2222-3333-4444-555555555555'
RAW = [
    {'record_id': RID, 'category': 'orcamento', 'priority': 'high', 'title': 'Orçamento 120',
     'subtitle': 'Aguardando resposta do cliente', 'link': '/orcamentos/' + RID, 'due_date': None,
     'days_late': None, 'amount': 1500, 'client_name': 'Cliente A'},
    {'record_id': RID, 'category': 'financeiro_pagar', 'priority': 'low', 'title': 'Conta fornecedor',
     'subtitle': '', 'link': '/financeiro', 'due_date': '2099-01-01', 'days_late': None, 'amount': 10, 'client_name': None},
    {'record_id': RID, 'category': 'desconhecida', 'priority': 'low', 'title': 'x', 'link': '/'},
]


@pytest.fixture
def crm_on(monkeypatch):
    calls = []
    def fake_post(path, body, token=None):
        calls.append(path)
        if path.startswith('/auth'):
            return {'access_token': 'tok', 'expires_in': 3600}
        assert token == 'tok'
        return RAW
    monkeypatch.setattr(crm, 'URL', 'https://crm.supabase.co')
    monkeypatch.setattr(crm, 'ANON', 'anon')
    monkeypatch.setattr(crm, 'EMAIL', 'jarvis@x')
    monkeypatch.setattr(crm, 'PASSWORD', 'p')
    monkeypatch.setattr(crm, 'SITE', 'https://crm.example')
    monkeypatch.setattr(crm, '_post', fake_post)
    crm.limpar_cache(); crm._token.update(value='', exp=0)
    yield calls
    crm.limpar_cache()


def test_sem_configuracao_briefing_continua(client):
    crm.limpar_cache()
    h = client.get('/hoje', headers=U).json()
    assert h['fontes'][0]['ok'] is False and h['empresas'][0]['total'] == 0


def test_crm_entra_no_hoje_da_marquinhos(client, crm_on):
    h = client.get('/hoje', headers=U).json()
    assert h['fontes'][0]['ok'] is True
    m, b = h['empresas']
    assert b['total'] == 0  # nada do CRM da Marquinhos vai para a Bielenki Metal
    assert [i['categoria'] for i in m['itens']] == ['cliente_retorno', 'financeiro']
    o = m['itens'][0]
    assert o['agente'] == 'comercial' and o['link'] == 'https://crm.example/orcamentos/' + RID and o['origem'] == 'crm'
    client.get('/hoje', headers=U)
    assert crm_on.count('/rest/v1/rpc/pending_center') == 1  # cache


def test_delegar_item_do_crm(client, crm_on):
    iid = f'crm:orcamento:{RID}'
    d = client.post('/crm/delegar', headers=U, json={'id': iid}).json()
    job = client.post('/worker/claim', headers=W).json()['job']
    assert job['id'] == d['job_id'] and job['agent'] == 'comercial'
    assert 'Orçamento 120' in job['prompt'] and 'Cliente A' in job['prompt']
    item = client.get('/hoje', headers=U).json()['empresas'][0]['itens'][0]
    assert item['status'] == 'delegada' and item['job_id'] == d['job_id']
    assert client.post('/crm/delegar', headers=U, json={'id': f'crm:compra:{RID}'}).status_code == 404
    assert client.post('/crm/delegar', headers=U, json={'id': 'crm:x:../../'}).status_code == 422


def test_crm_fora_do_ar(client, monkeypatch, crm_on):
    def boom(*a, **k): raise crm.CrmError('CRM indisponível')
    monkeypatch.setattr(crm, '_post', boom)
    h = client.get('/hoje', headers=U).json()
    assert h['fontes'][0] == {'nome': 'CRM Bielenki', 'empresa': 'marquinhos', 'ok': False, 'erro': 'CRM indisponível'}
    assert client.post('/crm/delegar', headers=U, json={'id': f'crm:orcamento:{RID}'}).status_code == 409


def test_lia_resumo(client, monkeypatch, crm_on):
    resumo = {'ativa': True, 'modo': 'semiautomatica', 'hoje': {'respondeu': 7, 'sugeriu': 2},
              'sugestoes': [{'conversa': RID, 'contato': 'João', 'texto': 'Pode mandar fotos?', 'desde': '2026-11-16T10:00:00Z'}],
              'aguardando_equipe': 3, 'falhas_24h': [{'motivo': 'Groq 429', 'quando': '2026-11-16T09:00:00Z'}]}
    def fake_post(path, body, token=None):
        if path.startswith('/auth'):
            return {'access_token': 'tok', 'expires_in': 3600}
        assert path == '/rest/v1/rpc/lia_status_center' and token == 'tok'
        return resumo
    monkeypatch.setattr(crm, '_post', fake_post)
    r = client.get('/crm/lia', headers=U).json()
    assert r['modo'] == 'semiautomatica' and r['hoje'] == {'respondeu': 7, 'sugeriu': 2}
    assert r['sugestoes'] == [{'contato': 'João', 'texto': 'Pode mandar fotos?', 'link': f'https://crm.example/atendimento?c={RID}'}]
    assert r['aguardando_equipe'] == 3 and r['falhas_24h'] == ['Groq 429']


def test_lia_crm_fora_do_ar(client, monkeypatch, crm_on):
    def boom(*a, **k): raise crm.CrmError('CRM indisponível')
    monkeypatch.setattr(crm, '_post', boom)
    assert client.get('/crm/lia', headers=U).status_code == 503


def test_erro_de_negocio_do_crm_e_mostrado(monkeypatch):
    import io, urllib.error
    monkeypatch.setattr(crm, 'URL', 'https://crm.supabase.co')
    def boom(req, timeout=10):
        raise urllib.error.HTTPError(req.full_url, 400, 'bad', {}, io.BytesIO(b'{"code":"P0001","message":"Cliente n\\u00e3o encontrado"}'))
    monkeypatch.setattr(crm.urllib.request, 'urlopen', boom)
    with pytest.raises(crm.CrmRecusa, match='Cliente não encontrado'):
        crm._post('/rest/v1/rpc/x', {})
    def boom500(req, timeout=10):
        raise urllib.error.HTTPError(req.full_url, 500, 'bad', {}, io.BytesIO(b'{"code":"XX000","message":"relation x"}'))
    monkeypatch.setattr(crm.urllib.request, 'urlopen', boom500)
    with pytest.raises(crm.CrmError) as e:
        crm._post('/rest/v1/rpc/x', {})
    assert not isinstance(e.value, crm.CrmRecusa) and 'relation' not in str(e.value)

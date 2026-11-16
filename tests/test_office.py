import sys
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud'))
import office
from test_cloud import client  # noqa: F401 (fixture)

U = {'X-API-Key': 'u' * 40}
W = {'X-Worker-Key': 'w' * 40}
HOJE = date(2026, 11, 16)


def item(cat, prazo=None, empresa='marquinhos', t=0):
    return {'id': cat + str(t), 'empresa': empresa, 'categoria': cat, 'titulo': cat,
            'prazo': prazo, 'created_at': t, 'cliente': None}


def test_ordem_segue_diretriz_e_prazo_sobe():
    itens = [item('melhoria'), item('financeiro'), item('urgente'),
             item('compra', (HOJE - timedelta(days=2)).isoformat()), item('compromisso', HOJE.isoformat())]
    out = office.ordenar(itens, HOJE)
    assert [i['categoria'] for i in out] == ['compra', 'compromisso', 'urgente', 'financeiro', 'melhoria']
    assert out[0]['motivo'] == 'atrasada 2 dia(s)' and out[1]['motivo'] == 'vence hoje'


def test_briefing_separa_empresas_sem_inventar():
    b = office.briefing([item('urgente'), item('financeiro', empresa='bielenki')], HOJE)
    m, bi = b['empresas']
    assert [i['empresa'] for i in m['itens']] == ['marquinhos']
    assert [i['empresa'] for i in bi['itens']] == ['bielenki']
    vazio = office.briefing([], HOJE)
    assert all('nenhuma pendência' in e['resumo'] for e in vazio['empresas'])


def test_fluxo_pendencia_delegar_e_hoje(client):
    assert client.get('/hoje').status_code == 401
    eq = client.get('/equipe', headers=U).json()
    assert {e['chave'] for e in eq['empresas']} == {'marquinhos', 'bielenki'}
    assert any(a['chave'] == 'secretario' for a in eq['agentes'])

    assert client.post('/hoje/plano', headers=U).status_code == 409
    r = client.post('/pendencias', headers=U, json={'empresa': 'marquinhos', 'categoria': 'cliente_retorno',
                                                    'titulo': 'Retornar orçamento de calha', 'cliente': 'Cliente X'})
    assert r.status_code == 201 and r.json()['agente'] == 'comercial'
    pid = r.json()['id']
    assert client.post('/pendencias', headers=U, json={'empresa': 'outra', 'categoria': 'urgente', 'titulo': 'abc'}).status_code == 422
    assert client.post('/pendencias', headers=U, json={'empresa': 'bielenki', 'categoria': 'urgente', 'titulo': 'abc', 'prazo': '16/11'}).status_code == 422

    h = client.get('/hoje', headers=U).json()
    assert h['empresas'][0]['total'] == 1 and h['empresas'][1]['total'] == 0

    d = client.post(f'/pendencias/{pid}/delegar', headers=U).json()
    assert d['agente'] == 'comercial'
    job = client.post('/worker/claim', headers=W, params={'worker_id': 'pc'}).json()['job']
    assert job['id'] == d['job_id'] and job['agent'] == 'comercial'
    assert 'Assistente Comercial' in job['system'] and 'Marquinhos' in job['prompt']
    assert 'Bielenki Metal' not in job['prompt']

    assert client.patch(f'/pendencias/{pid}', headers=U, json={'status': 'concluida'}).json()['status'] == 'concluida'
    assert client.post(f'/pendencias/{pid}/delegar', headers=U).status_code == 409
    assert client.get('/hoje', headers=U).json()['empresas'][0]['total'] == 0


def test_plano_do_dia_vai_para_secretario(client):
    client.post('/pendencias', headers=U, json={'empresa': 'bielenki', 'categoria': 'financeiro', 'titulo': 'Boleto fornecedor'})
    jid = client.post('/hoje/plano', headers=U).json()['id']
    job = client.post('/worker/claim', headers=W).json()['job']
    assert job['id'] == jid and job['agent'] == 'secretario' and 'Boleto fornecedor' in job['prompt']


def test_novos_agentes_aceitos_em_jobs(client):
    assert client.post('/jobs', headers=U, json={'agent': 'financeiro', 'prompt': 'analise'}).status_code == 201

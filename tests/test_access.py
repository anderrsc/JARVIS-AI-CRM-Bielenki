import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud'))
import crm
from test_cloud import client  # noqa: F401
from test_crm import crm_on, RID  # noqa: F401

U = {'X-API-Key': 'u' * 40}
W = {'X-Worker-Key': 'w' * 40}
MID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
M = {**U, 'X-Jarvis-User': MID}


def membro(client, acessos):
    r = client.put(f'/usuarios/{MID}', headers=U, json={'id': MID, 'email': 'func@x.com', 'acessos': acessos})
    assert r.status_code == 200, r.text
    return r.json()


def test_desconhecido_e_revogado_sem_acesso(client):
    assert client.get('/hoje', headers=M).status_code == 403
    assert client.get('/hoje', headers={**U, 'X-Jarvis-User': '../x'}).status_code == 403
    membro(client, {'marquinhos': ['hoje']})
    assert client.get('/hoje', headers=M).status_code == 200
    client.post(f'/usuarios/{MID}/ativo?ativo=false', headers=U)
    assert client.get('/hoje', headers=M).status_code == 403


def test_funcionario_da_marquinhos_nao_ve_bielenki(client):
    membro(client, {'marquinhos': ['hoje', 'pendencias', 'delegar', 'conhecimento']})
    b = client.post('/pendencias', headers=U, json={'empresa': 'bielenki', 'categoria': 'financeiro', 'titulo': 'Faturamento Bielenki'}).json()
    client.post('/pendencias', headers=U, json={'empresa': 'marquinhos', 'categoria': 'urgente', 'titulo': 'Medir obra'})
    rb = client.post('/conhecimento', headers=U, json={'empresa': 'bielenki', 'assunto': 'financeiro', 'texto': 'Regra secreta Bielenki'}).json()['regra']

    h = client.get('/hoje', headers=M).json()
    assert [e['empresa'] for e in h['empresas']] == ['marquinhos']
    assert 'Bielenki Metal' not in str(h) and 'Faturamento' not in str(h)
    assert [e['chave'] for e in client.get('/equipe', headers=M).json()['empresas']] == ['marquinhos']
    assert all(p['empresa'] == 'marquinhos' for p in client.get('/pendencias', headers=M).json()['pendencias'])
    assert client.get('/pendencias?empresa=bielenki', headers=M).status_code == 403
    assert client.get(f"/pendencias/{b['id']}", headers=M).status_code == 404
    assert client.post(f"/pendencias/{b['id']}/delegar", headers=M).status_code == 404
    assert client.patch(f"/pendencias/{b['id']}", headers=M, json={'status': 'concluida'}).status_code == 404
    assert client.post('/pendencias', headers=M, json={'empresa': 'bielenki', 'categoria': 'urgente', 'titulo': 'abc'}).status_code == 403
    assert client.get('/conhecimento?empresa=bielenki', headers=M).status_code == 403
    assert client.post(f"/conhecimento/{rb['id']}/confirmar", headers=M).status_code == 404
    assert client.post('/jobs', headers=M, json={'agent': 'financeiro', 'prompt': 'quanto a Bielenki faturou?', 'empresa': 'bielenki'}).status_code == 403
    # regras da Bielenki nunca vão para uma tarefa dele
    client.post(f"/conhecimento/{rb['id']}/confirmar", headers=U)
    client.post('/jobs', headers=M, json={'agent': 'financeiro', 'prompt': 'quanto a Bielenki faturou?'})
    assert 'Regra secreta' not in client.post('/worker/claim', headers=W).json()['job']['system']


def test_modulos_e_tarefas_proprias(client):
    membro(client, {'marquinhos': ['hoje', 'conhecimento', 'conhecimento_editar']})
    assert client.post('/jobs', headers=M, json={'agent': 'jarvis', 'prompt': 'abc'}).status_code == 403
    r = client.post('/conhecimento', headers=M, json={'empresa': 'marquinhos', 'assunto': 'medicao', 'texto': 'Conferir medidas sempre'}).json()['regra']
    assert client.post(f"/conhecimento/{r['id']}/confirmar", headers=M).status_code == 403  # aprovar é outro módulo

    membro(client, {'marquinhos': ['delegar']})
    assert client.post('/jobs', headers=M, json={'agent': 'programador', 'prompt': 'abc'}).status_code == 403
    dono = client.post('/jobs', headers=U, json={'agent': 'jarvis', 'prompt': 'do dono'}).json()['id']
    meu = client.post('/jobs', headers=M, json={'agent': 'comercial', 'prompt': 'meu', 'empresa': 'marquinhos'}).json()['id']
    assert [j['id'] for j in client.get('/jobs', headers=M).json()['jobs']] == [meu]
    assert client.get(f'/jobs/{dono}', headers=M).status_code == 404
    assert 'usuario' not in client.get(f'/jobs/{meu}', headers=U).json()


def test_crm_so_com_permissao(client, crm_on):
    membro(client, {'bielenki': ['hoje', 'delegar']})
    h = client.get('/hoje', headers=M).json()
    assert h['fontes'] == [] and '/rest/v1/rpc/pending_center' not in crm_on  # nem consulta o CRM
    assert client.post('/crm/delegar', headers=M, json={'id': f'crm:orcamento:{RID}'}).status_code == 403


def test_admin_so_dono_e_auditoria(client):
    membro(client, {'marquinhos': ['hoje']})
    assert client.get('/usuarios', headers=M).status_code == 403
    assert client.put(f'/usuarios/{MID}', headers=M, json={'id': MID, 'email': 'x@x', 'acessos': {'bielenki': ['hoje']}}).status_code == 403
    assert client.get('/auditoria', headers=M).status_code == 403
    assert client.put(f'/usuarios/{MID}', headers=U, json={'id': MID, 'email': 'x@x', 'acessos': {'outra': ['hoje']}}).status_code == 422
    assert client.put(f'/usuarios/{MID}', headers=U, json={'id': MID, 'email': 'x@x', 'acessos': {'marquinhos': ['root']}}).status_code == 422
    me = client.get('/me', headers=M).json()
    assert me['proprietario'] is False and me['acessos'] == {'marquinhos': ['hoje']}
    ev = client.get('/auditoria', headers=U).json()['eventos']
    assert any(e['tipo'] == 'usuario.acessos' for e in ev)

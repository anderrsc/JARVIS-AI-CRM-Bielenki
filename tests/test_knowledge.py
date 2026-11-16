from test_cloud import client  # noqa: F401

U = {'X-API-Key': 'u' * 40}
W = {'X-Worker-Key': 'w' * 40}
REGRA = 'Pedido de esquadria fechado exige nova conferência de medidas antes do corte.'


def nova(client, empresa='marquinhos', texto=REGRA, assunto='medicao'):
    return client.post('/conhecimento', headers=U, json={'empresa': empresa, 'assunto': assunto, 'texto': texto})


def test_regra_so_vale_depois_de_confirmada_e_so_na_empresa(client):
    r = nova(client).json()
    assert r['regra']['estado'] == 'provisoria' and r['semelhantes'] == []
    rid = r['regra']['id']
    client.post('/jobs', headers=U, json={'agent': 'producao', 'prompt': 'organize o corte', 'empresa': 'marquinhos'})
    job = client.post('/worker/claim', headers=W).json()['job']
    assert 'antes do corte' not in job['system']  # provisória não chega aos agentes

    assert client.post(f'/conhecimento/{rid}/confirmar', headers=U).json()['estado'] == 'confirmada'
    client.post('/jobs', headers=U, json={'agent': 'producao', 'prompt': 'organize o corte', 'empresa': 'marquinhos'})
    job = client.post('/worker/claim', headers=W).json()['job']
    assert 'Regras confirmadas da Marquinhos' in job['system'] and 'antes do corte' in job['system']

    client.post('/jobs', headers=U, json={'agent': 'producao', 'prompt': 'organize o corte', 'empresa': 'bielenki'})
    job = client.post('/worker/claim', headers=W).json()['job']
    assert 'antes do corte' not in job['system']  # isolamento entre empresas


def test_semelhante_e_versoes(client):
    rid = nova(client).json()['regra']['id']
    client.post(f'/conhecimento/{rid}/confirmar', headers=U)
    dup = nova(client, texto='Esquadria com pedido fechado: fazer nova conferência das medidas antes do corte.').json()
    assert [s['id'] for s in dup['semelhantes']] == [rid]
    assert nova(client, empresa='bielenki').json()['semelhantes'] == []

    v2 = client.post(f'/conhecimento/{rid}/editar', headers=U, json={'texto': REGRA + ' Vale também para vidros.'}).json()
    assert v2['versao'] == 2 and v2['estado'] == 'provisoria'
    v3 = client.post(f"/conhecimento/{v2['id']}/editar", headers=U, json={'texto': REGRA + ' Vale para vidros temperados.'}).json()
    estados = {r['id']: r['estado'] for r in client.get('/conhecimento?empresa=marquinhos', headers=U).json()['regras']}
    assert estados[rid] == 'confirmada' and v2['id'] not in estados  # v1 segue valendo até confirmar a nova
    client.post(f"/conhecimento/{v3['id']}/confirmar", headers=U)
    estados = {r['id']: r['estado'] for r in client.get('/conhecimento?empresa=marquinhos', headers=U).json()['regras']}
    assert rid not in estados and estados[v3['id']] == 'confirmada'
    assert client.post(f"/conhecimento/{v3['id']}/confirmar", headers=U).status_code == 409
    client.post(f"/conhecimento/{v3['id']}/arquivar", headers=U)
    assert v3['id'] not in {r['id'] for r in client.get('/conhecimento?empresa=marquinhos', headers=U).json()['regras']}


def test_validacoes(client):
    assert nova(client, empresa='x').status_code == 422
    assert nova(client, assunto='x').status_code == 422
    assert client.post('/conhecimento', headers=U, json={'empresa': 'marquinhos', 'assunto': 'outro', 'texto': 'abcdef', 'estado': 'confirmada'}).status_code == 422
    assert client.get('/conhecimento?empresa=x', headers=U).status_code == 422
    assert client.post('/jobs', headers=U, json={'agent': 'jarvis', 'prompt': 'abc', 'empresa': 'x'}).status_code == 422

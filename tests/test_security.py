import importlib, sys
from test_cloud import client  # noqa: F401

U = {'X-API-Key': 'u' * 40}


def test_mass_assignment_bloqueado(client):
    r = client.post('/pendencias', headers=U, json={'empresa': 'marquinhos', 'categoria': 'urgente', 'titulo': 'abc', 'status': 'concluida'})
    assert r.status_code == 422
    assert client.post('/jobs', headers=U, json={'agent': 'jarvis', 'prompt': 'abc', 'usuario': 'outro'}).status_code == 422


def test_headers_e_sem_openapi(client):
    r = client.get('/health')
    assert r.headers['x-content-type-options'] == 'nosniff' and r.headers['x-frame-options'] == 'DENY'
    assert client.get('/openapi.json').status_code == 404


def test_rate_limit_ia(client):
    app = sys.modules['app']
    app.RATE_MAX = 3
    for _ in range(3):
        assert client.post('/jobs', headers=U, json={'agent': 'jarvis', 'prompt': 'abc'}).status_code == 201
    assert client.post('/jobs', headers=U, json={'agent': 'jarvis', 'prompt': 'abc'}).status_code == 429


def test_sql_injection_nao_quebra(client):
    r = client.get("/pendencias?empresa=marquinhos' OR '1'='1", headers=U)
    assert r.status_code == 200 and r.json()['pendencias'] == []

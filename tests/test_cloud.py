import os, sys, importlib
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('JARVIS_DB',str(tmp_path/'test.db'))
    monkeypatch.setenv('JARVIS_USER_KEY','u'*40)
    monkeypatch.setenv('JARVIS_WORKER_KEY','w'*40)
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'cloud'))
    sys.modules.pop('app',None)
    module=importlib.import_module('app')
    return TestClient(module.app)

def test_health(client):
    assert client.get('/health').json()['status']=='ok'

def test_auth(client):
    assert client.post('/jobs',json={'prompt':'analisar erros'}).status_code==401
    assert client.post('/worker/claim').status_code==401

def test_queue_flow(client):
    user={'X-API-Key':'u'*40}; worker={'X-Worker-Key':'w'*40}
    j=client.post('/jobs',headers=user,json={'agent':'sentinel','prompt':'analise o CRM'}).json()['id']
    claimed=client.post('/worker/claim',headers=worker,params={'worker_id':'pc'}).json()['job']
    assert claimed['id']==j
    assert client.post('/worker/jobs/'+j+'/complete',headers=worker,json={'worker_id':'outro','result':'ok'}).status_code==409
    assert client.post('/worker/jobs/'+j+'/complete',headers=worker,json={'worker_id':'pc','result':'Sem falhas observadas'}).status_code==200
    assert client.get('/jobs/'+j,headers=user).json()['status']=='completed'
    assert client.post('/worker/claim',headers=worker).json()['job'] is None

def test_validation(client):
    user={'X-API-Key':'u'*40}
    assert client.post('/jobs',headers=user,json={'agent':'root','prompt':'abc'}).status_code==422
    assert client.post('/jobs',headers=user,json={'prompt':'a'}).status_code==422

def test_not_found(client):
    assert client.get('/jobs/missing',headers={'X-API-Key':'u'*40}).status_code==404

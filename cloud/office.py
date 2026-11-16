"""Escritório JARVIS: equipe de funcionários digitais, pendências por empresa e briefing do dia.

Nada aqui inventa dados das empresas: o briefing usa apenas pendências cadastradas.
"""
from datetime import datetime, timedelta, timezone, date

# Brasil sem horário de verão desde 2019; evita depender de tzdata na imagem slim.
BRT = timezone(timedelta(hours=-3))

EMPRESAS = {
    'marquinhos': 'Marquinhos Calhas e Esquadrias',
    'bielenki': 'Bielenki Metal',
}

_REGRAS = (' Responda em português, de forma objetiva. Use apenas os dados fornecidos; '
           'se faltar informação, liste o que falta. Não afirme que executou ações externas '
           'nem envie mensagens a clientes: prepare rascunhos para aprovação do proprietário. '
           'Mantenha separados os dados da Marquinhos Calhas e Esquadrias e da Bielenki Metal.')

# chave -> (nome, departamento, papel). O papel vira o prompt de sistema do worker.
AGENTES = {
    'jarvis': ('JARVIS', 'Coordenação',
               'Você é JARVIS, coordenador da equipe de funcionários digitais. Planeje e delegue tarefas aos agentes adequados.'),
    'secretario': ('Secretário Executivo', 'Diretoria',
                   'Você é o Secretário Executivo do proprietário. Organize o dia, priorize pendências das duas empresas, '
                   'aponte o que exige decisão e proponha as próximas ações em ordem.'),
    'comercial': ('Assistente Comercial', 'Comercial',
                  'Você é o Assistente Comercial. Organize leads, acompanhe orçamentos e clientes aguardando retorno, '
                  'sugira negociações e prepare mensagens comerciais como rascunho.'),
    'orcamentos': ('Assistente de Orçamentos', 'Comercial',
                   'Você é o Assistente de Orçamentos (calhas, esquadrias, vidros e serviços). Confira quantidades, '
                   'regras de preço e condições; aponte informações ausentes e inconsistências. Nunca invente preços.'),
    'producao': ('Coordenador de Produção', 'Operações',
                 'Você é o Coordenador de Produção. Acompanhe pedidos aprovados, conferência de medidas, corte, fabricação, '
                 'materiais pendentes e atrasos; priorize por data de entrega.'),
    'instalacoes': ('Coordenador de Instalações', 'Operações',
                    'Você é o Coordenador de Instalações. Organize instalações, equipes, roteiros, retornos e reparos; '
                    'aponte serviços prontos e conflitos de agenda.'),
    'financeiro': ('Assistente Financeiro', 'Financeiro',
                   'Você é o Assistente Financeiro. Acompanhe contas a pagar e a receber, cobranças, vencimentos, '
                   'divergências e previsão de caixa por empresa.'),
    'compras': ('Assistente de Compras', 'Suprimentos',
                'Você é o Assistente de Compras. Identifique materiais necessários e faltantes, organize solicitações, '
                'compare fornecedores e relacione compras às obras.'),
    'atendimento': ('Assistente de Atendimento', 'Atendimento',
                    'Você é o Assistente de Atendimento. Classifique solicitações, identifique urgências e prepare '
                    'respostas como rascunho; nunca envie mensagens sem autorização.'),
    'administrativo': ('Assistente Administrativo', 'Administrativo',
                       'Você é o Assistente Administrativo. Organize documentos, contratos, cadastros e relatórios '
                       'para aprovação.'),
    'gestao': ('Analista de Gestão', 'Gestão',
               'Você é o Analista de Gestão. Avalie resultados, gargalos, produtividade e desperdícios; '
               'compare indicadores e sugira melhorias.'),
    'programador': ('Programador', 'Equipe técnica',
                    'Você é o Programador full-stack da equipe técnica. Analise código, proponha correções e testes; '
                    'não publique nada em produção sem aprovação.'),
    'pesquisador': ('Pesquisador', 'Pesquisa',
                    'Você é o Pesquisador. Levante tecnologias, fornecedores e soluções; separe fatos de hipóteses '
                    'e indique o que precisa ser verificado.'),
    'sentinel': ('SENTINEL (Auditor)', 'Equipe técnica',
                 'Você é SENTINEL, auditor de software. Responda com riscos, gravidade, evidências disponíveis e testes '
                 'recomendados. Não invente testes executados.'),
}


def system_prompt(agent: str) -> str:
    papel = AGENTES.get(agent, AGENTES['jarvis'])[2]
    return papel + _REGRAS


# Ordem de prioridade do modo ASSISTENTE DE TRABALHO (diretriz, item 4) e agente responsável.
CATEGORIAS = {
    'urgente': ('Pendência urgente', 'secretario'),
    'cliente_retorno': ('Cliente aguardando retorno', 'comercial'),
    'prazo': ('Serviço com prazo próximo', 'producao'),
    'producao': ('Problema de produção', 'producao'),
    'instalacao': ('Instalação pendente', 'instalacoes'),
    'financeiro': ('Cobrança ou vencimento', 'financeiro'),
    'compra': ('Compra necessária', 'compras'),
    'compromisso': ('Compromisso', 'secretario'),
    'decisao': ('Decisão aguardando aprovação', 'secretario'),
    'melhoria': ('Oportunidade de melhoria', 'gestao'),
}
RANK = {c: i for i, c in enumerate(CATEGORIAS)}
STATUS_ABERTOS = ('aberta', 'delegada')
JANELA_PRAZO_DIAS = 3

SCHEMA_EMPRESAS = 'CREATE TABLE IF NOT EXISTS empresas (chave TEXT PRIMARY KEY, nome TEXT NOT NULL)'
# Registro persistente de tudo que muda (base da auditoria e da comunicação entre agentes).
SCHEMA_EVENTOS = '''CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, empresa TEXT, ator TEXT NOT NULL,
  tipo TEXT NOT NULL, recurso TEXT, detalhe TEXT)'''

SCHEMA = '''CREATE TABLE IF NOT EXISTS pendencias (
  id TEXT PRIMARY KEY, empresa TEXT NOT NULL, categoria TEXT NOT NULL,
  titulo TEXT NOT NULL, detalhe TEXT, cliente TEXT, prazo TEXT,
  status TEXT NOT NULL DEFAULT 'aberta', agente TEXT NOT NULL, job_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, concluded_at INTEGER)'''


def hoje_brt(now: float | None = None) -> date:
    return datetime.fromtimestamp(now if now is not None else datetime.now().timestamp(), BRT).date()


def motivo_prazo(prazo: str | None, hoje: date) -> tuple[int, str]:
    """(dias até o prazo, texto). Sem prazo: (10**6, '')."""
    if not prazo:
        return 10**6, ''
    dias = (date.fromisoformat(prazo) - hoje).days
    if dias < 0:
        return dias, f'atrasada {-dias} dia(s)'
    if dias == 0:
        return 0, 'vence hoje'
    if dias == 1:
        return 1, 'vence amanhã'
    return dias, f'vence em {dias} dias'


def ordenar(itens: list[dict], hoje: date) -> list[dict]:
    """Atrasadas e vencendo na janela sobem; depois segue a ordem de categorias da diretriz."""
    out = []
    for it in itens:
        dias, motivo = motivo_prazo(it.get('prazo'), hoje)
        it = dict(it, motivo=motivo, dias=dias if dias != 10**6 else None)
        it['_k'] = (0 if dias <= JANELA_PRAZO_DIAS else 1, RANK.get(it['categoria'], 99), dias, it['created_at'])
        out.append(it)
    out.sort(key=lambda i: i['_k'])
    for it in out:
        del it['_k']
    return out


def briefing(itens: list[dict], hoje: date, empresas_cadastradas: dict | None = None) -> dict:
    empresas = []
    for chave, nome in (empresas_cadastradas or EMPRESAS).items():
        lista = ordenar([i for i in itens if i['empresa'] == chave], hoje)
        contagem = {}
        for i in lista:
            contagem[i['categoria']] = contagem.get(i['categoria'], 0) + 1
        atrasadas = sum(1 for i in lista if i['dias'] is not None and i['dias'] < 0)
        if lista:
            partes = [f"{n} {CATEGORIAS[c][0].lower()}" + ('' if n == 1 else ' (itens)')
                      for c, n in sorted(contagem.items(), key=lambda kv: RANK.get(kv[0], 99))]
            resumo = f"Na {nome}: " + '; '.join(partes) + '.'
            if atrasadas:
                resumo += f' {atrasadas} atrasada(s).'
        else:
            resumo = f'Na {nome}: nenhuma pendência cadastrada.'
        empresas.append({'empresa': chave, 'nome': nome, 'resumo': resumo,
                         'atrasadas': atrasadas, 'total': len(lista), 'itens': lista})
    return {'data': hoje.isoformat(), 'empresas': empresas}


def briefing_texto(b: dict) -> str:
    """Texto enviado ao Secretário Executivo para montar o plano do dia."""
    linhas = [f"Data: {b['data']}. Pendências cadastradas, já ordenadas por prioridade:"]
    for e in b['empresas']:
        linhas.append(f"\n## {e['nome']}")
        if not e['itens']:
            linhas.append('- (nenhuma)')
        for i in e['itens'][:10]:
            extra = ', '.join(x for x in (i['motivo'], f"cliente: {i['cliente']}" if i.get('cliente') else '') if x)
            linhas.append(f"- [{CATEGORIAS[i['categoria']][0]}] {i['titulo']}" + (f' ({extra})' if extra else ''))
    linhas.append('\nMonte o plano de trabalho de hoje: o que resolver primeiro, o que delegar a qual agente '
                  'e quais decisões dependem do proprietário.')
    return '\n'.join(linhas)

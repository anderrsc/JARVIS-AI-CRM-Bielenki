"""Central de Conhecimento Empresarial.

Regras e procedimentos por empresa, com estado explícito. Só regras *confirmadas* pelo proprietário
chegam aos agentes; a IA nunca altera uma regra confirmada. Editar cria uma nova versão.
"""
import re, unicodedata

ESTADOS = ('provisoria', 'hipotese', 'sugestao', 'confirmada', 'substituida', 'arquivada')
ATIVOS = ('provisoria', 'hipotese', 'sugestao', 'confirmada')

ASSUNTOS = {
    'comercial': 'Comercial e condições', 'precos': 'Tabelas e preços', 'calhas': 'Calhas, rufos, pingadeiras e condutores',
    'esquadrias': 'Esquadrias e vidros', 'medicao': 'Medição e conferência', 'producao': 'Produção e corte',
    'instalacao': 'Instalação', 'garantia': 'Garantia e pós-venda', 'financeiro': 'Financeiro e cobrança',
    'compras': 'Compras e fornecedores', 'atendimento': 'Atendimento', 'administrativo': 'Administrativo e documentos',
    'outro': 'Outro',
}

# Categoria da pendência -> assuntos de regra mais relevantes
RELEVANTES = {
    'cliente_retorno': ('comercial', 'precos', 'atendimento'), 'prazo': ('producao', 'medicao', 'instalacao'),
    'producao': ('producao', 'medicao', 'calhas', 'esquadrias'), 'instalacao': ('instalacao', 'garantia'),
    'financeiro': ('financeiro',), 'compra': ('compras',), 'urgente': (), 'compromisso': (),
    'decisao': (), 'melhoria': (),
}

SCHEMA = '''CREATE TABLE IF NOT EXISTS conhecimento (
  id TEXT PRIMARY KEY, empresa TEXT NOT NULL, assunto TEXT NOT NULL, texto TEXT NOT NULL,
  estado TEXT NOT NULL, fonte TEXT, versao INTEGER NOT NULL DEFAULT 1, anterior_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirmado_em INTEGER)'''

LIMITE_CONTEXTO = 1500  # caracteres; o modelo da VPS tem contexto curto


def _palavras(t: str) -> set[str]:
    t = unicodedata.normalize('NFKD', t.lower()).encode('ascii', 'ignore').decode()
    return {w for w in re.findall(r'[a-z0-9]{4,}', t)}


def semelhantes(texto: str, regras: list[dict], minimo: float = 0.5) -> list[dict]:
    """Regras ativas com muitas palavras em comum (possível duplicata ou conflito)."""
    a = _palavras(texto)
    if not a:
        return []
    out = []
    for r in regras:
        b = _palavras(r['texto'])
        if b and len(a & b) / min(len(a), len(b)) >= minimo:
            out.append(r)
    return out


def contexto(regras_por_empresa: dict[str, tuple[str, list[dict]]], categoria: str | None = None) -> str:
    """Texto com as regras confirmadas, separado por empresa, priorizando assuntos relevantes."""
    blocos, total = [], 0
    rel = RELEVANTES.get(categoria or '', ())
    for chave, (nome, regras) in regras_por_empresa.items():
        regras = sorted(regras, key=lambda r: (r['assunto'] not in rel, -r['updated_at']))
        linhas = []
        for r in regras:
            linha = f"- [{ASSUNTOS.get(r['assunto'], r['assunto'])}] {r['texto']}"
            if total + len(linha) > LIMITE_CONTEXTO:
                break
            linhas.append(linha); total += len(linha)
        if linhas:
            blocos.append(f'Regras confirmadas da {nome} (use só para a {nome}):\n' + '\n'.join(linhas))
    return '\n\n'.join(blocos)

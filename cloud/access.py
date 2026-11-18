"""Usuários, acessos por empresa e módulo.

Quem chama a API é o servidor do painel (com JARVIS_USER_KEY). Sem cabeçalho X-Jarvis-User a chamada
é do proprietário. Com o cabeçalho, é de um membro cadastrado pelo proprietário e só vale o que ele
tiver liberado, empresa por empresa. A checagem é sempre no backend, nunca só na interface.
"""
import re
from dataclasses import dataclass, field

MODULOS = {
    'hoje': 'Ver pendências do dia',
    'pendencias': 'Registrar e concluir pendências',
    'delegar': 'Delegar a funcionários digitais e criar tarefas',
    'atendimento': 'Ver o atendimento do WhatsApp (Lia)',
    'agenda': 'Buscar clientes e agendar medições no CRM',
    'conhecimento': 'Consultar regras da empresa',
    'conhecimento_editar': 'Propor e editar regras',
    'conhecimento_aprovar': 'Confirmar e arquivar regras',
}

UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

SCHEMA_USUARIOS = '''CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, nome TEXT, cargo TEXT, ativo INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ultimo_acesso INTEGER)'''
SCHEMA_ACESSOS = '''CREATE TABLE IF NOT EXISTS acessos (
  usuario_id TEXT NOT NULL, empresa TEXT NOT NULL, modulo TEXT NOT NULL,
  PRIMARY KEY (usuario_id, empresa, modulo))'''


@dataclass
class Ator:
    id: str  # 'proprietario' ou UUID do usuário no Supabase do painel
    dono: bool
    perms: dict[str, set[str]] = field(default_factory=dict)

    def pode(self, empresa: str | None, modulo: str) -> bool:
        return self.dono or (empresa is not None and modulo in self.perms.get(empresa, set()))

    def empresas(self, modulo: str, todas: dict[str, str]) -> dict[str, str]:
        return dict(todas) if self.dono else {k: v for k, v in todas.items() if modulo in self.perms.get(k, set())}

    def alguma(self, modulo: str) -> bool:
        return self.dono or any(modulo in m for m in self.perms.values())


DONO = Ator('proprietario', True)

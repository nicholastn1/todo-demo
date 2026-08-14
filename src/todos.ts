export type Status = 'pending' | 'done' | 'archived'

export type Todo = {
  id: number
  title: string
  status: Status
}

export type Filter = 'all' | 'pending' | 'done' | 'archived'

/** One home for the words the UI shows for a status — the row stamp, the
 * command palette's search, and anything else that names one. */
export const STATUS_LABEL: Record<Status, string> = {
  pending: 'aberta',
  done: 'concluída',
  archived: 'arquivada',
}

export const seed: Todo[] = [
  { id: 1, title: 'Escrever documentação da API', status: 'pending' },
  { id: 2, title: 'Revisar proposta de arquitetura', status: 'pending' },
  { id: 3, title: 'Configurar pipeline de staging', status: 'pending' },
  { id: 4, title: 'Reservar sala de reunião', status: 'done' },
  { id: 5, title: 'Enviar convite pro time', status: 'done' },
  { id: 6, title: 'Padronizar variáveis de ambiente', status: 'pending' },
  { id: 7, title: 'Configurar Vite + Vitest', status: 'done' },
  { id: 8, title: 'Ajustar tema claro/escuro', status: 'pending' },
  { id: 9, title: 'Escrever testes de filtro', status: 'done' },
  { id: 10, title: 'Renovar certificado SSL', status: 'archived' },
  { id: 11, title: 'Migrar cluster K3s pro Proxmox', status: 'archived' },
  { id: 12, title: 'Limpar branches antigas', status: 'archived' },
  { id: 13, title: 'Atualizar dependências do projeto', status: 'pending' },
  { id: 14, title: 'Documentar deploy no Coolify', status: 'done' },
  { id: 15, title: 'Responder e-mails pendentes', status: 'pending' },
  { id: 16, title: 'Comprar café pro escritório', status: 'archived' },
  { id: 17, title: 'Agendar 1:1 com o time', status: 'done' },
  { id: 18, title: 'Revisar PR #142', status: 'pending' },
  { id: 19, title: 'Backup do banco de dados', status: 'done' },
  { id: 20, title: 'Cancelar assinatura não usada', status: 'archived' },
]

export const nextId = (todos: Todo[]) =>
  todos.reduce((max, t) => Math.max(max, t.id), 0) + 1

export const addTodo = (todos: Todo[], title: string): Todo[] => {
  const clean = title.trim()
  if (!clean) return todos
  return [...todos, { id: nextId(todos), title: clean, status: 'pending' }]
}

export const toggleTodo = (todos: Todo[], id: number): Todo[] =>
  todos.map((t) =>
    t.id === id && t.status !== 'archived'
      ? { ...t, status: t.status === 'done' ? 'pending' : 'done' }
      : t,
  )

export const archiveDone = (todos: Todo[]): Todo[] =>
  todos.map((t) => (t.status === 'done' ? { ...t, status: 'archived' } : t))

export const filterTodos = (todos: Todo[], filter: Filter): Todo[] =>
  filter === 'all'
    ? todos.filter((t) => t.status !== 'archived')
    : todos.filter((t) => t.status === filter)

export const countBy = (todos: Todo[], status: Status) =>
  todos.filter((t) => t.status === status).length

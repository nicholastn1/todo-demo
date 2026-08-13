import { describe, expect, it } from 'vitest'
import {
  addTodo,
  archiveDone,
  countBy,
  filterTodos,
  seed,
  toggleTodo,
  type Todo,
} from './todos'

const sample: Todo[] = [
  { id: 1, title: 'a', status: 'pending' },
  { id: 2, title: 'b', status: 'done' },
  { id: 3, title: 'c', status: 'archived' },
]

describe('seed', () => {
  it('tem 20 tarefas cobrindo os três status', () => {
    expect(seed).toHaveLength(20)
    expect(countBy(seed, 'pending')).toBeGreaterThan(0)
    expect(countBy(seed, 'done')).toBeGreaterThan(0)
    expect(countBy(seed, 'archived')).toBeGreaterThan(0)
  })
})

describe('addTodo', () => {
  it('adiciona como pending com id novo', () => {
    const next = addTodo(sample, '  nova  ')
    expect(next).toHaveLength(4)
    expect(next[3]).toEqual({ id: 4, title: 'nova', status: 'pending' })
  })

  it('ignora título vazio', () => {
    expect(addTodo(sample, '   ')).toBe(sample)
  })
})

describe('toggleTodo', () => {
  it('alterna pending <-> done', () => {
    expect(toggleTodo(sample, 1)[0].status).toBe('done')
    expect(toggleTodo(sample, 2)[1].status).toBe('pending')
  })

  it('não mexe em arquivadas', () => {
    expect(toggleTodo(sample, 3)[2].status).toBe('archived')
  })
})

describe('archiveDone', () => {
  it('arquiva só as concluídas', () => {
    expect(archiveDone(sample).map((t) => t.status)).toEqual([
      'pending',
      'archived',
      'archived',
    ])
  })
})

describe('filterTodos', () => {
  it('"all" esconde arquivadas', () => {
    expect(filterTodos(sample, 'all').map((t) => t.id)).toEqual([1, 2])
  })

  it('filtra por status', () => {
    expect(filterTodos(sample, 'pending').map((t) => t.id)).toEqual([1])
    expect(filterTodos(sample, 'done').map((t) => t.id)).toEqual([2])
    expect(filterTodos(sample, 'archived').map((t) => t.id)).toEqual([3])
  })
})

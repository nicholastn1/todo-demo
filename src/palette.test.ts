import { describe, expect, it } from 'vitest'
import { buildItems, matchesQuery, moveSelection, normalize, todoMatches } from './palette'
import type { Todo } from './todos'

const sample: Todo[] = [
  { id: 1, title: 'Escrever documentação da API', status: 'pending' },
  { id: 2, title: 'Reservar sala de reunião', status: 'done' },
  { id: 3, title: 'Renovar certificado SSL', status: 'archived' },
]

describe('normalize', () => {
  it('remove acentos, caixa e espaços nas pontas', () => {
    expect(normalize('  Concluída ')).toBe('concluida')
    expect(normalize('DOCUMENTAÇÃO')).toBe('documentacao')
  })
})

describe('matchesQuery', () => {
  it('acha sem acento e sem caixa', () => {
    expect(matchesQuery('Escrever documentação da API', 'DOCUMENTACAO')).toBe(true)
    expect(matchesQuery('Reservar sala de reunião', 'reuniao')).toBe(true)
  })

  it('query vazia casa com tudo', () => {
    expect(matchesQuery('qualquer coisa', '')).toBe(true)
  })

  it('não casa o que não está lá', () => {
    expect(matchesQuery('Reservar sala', 'servidor')).toBe(false)
  })
})

describe('todoMatches', () => {
  it('acha pelo título', () => {
    expect(todoMatches(sample[0], 'api')).toBe(true)
  })

  it('acha pela palavra do status', () => {
    expect(todoMatches(sample[1], 'concluida')).toBe(true)
    expect(todoMatches(sample[0], 'aberta')).toBe(true)
    expect(todoMatches(sample[0], 'concluida')).toBe(false)
  })
})

describe('buildItems', () => {
  it('lista comandos antes das tarefas', () => {
    const items = buildItems(sample, '')
    expect(items[0].kind).toBe('filter')
    expect(items.filter((i) => i.kind === 'todo')).toHaveLength(2)
  })

  it('esconde as arquivadas', () => {
    const items = buildItems(sample, '')
    expect(items.some((i) => i.kind === 'todo' && i.todo.status === 'archived')).toBe(false)
  })

  it('esconde arquivar quando não há concluídas', () => {
    const semConcluidas = sample.map((t) => ({ ...t, status: 'pending' as const }))
    expect(buildItems(semConcluidas, '').some((i) => i.kind === 'archive')).toBe(false)
  })

  it('conta as concluídas na dica do arquivar', () => {
    const archive = buildItems(sample, 'arquivar').find((i) => i.kind === 'archive')
    expect(archive?.hint).toBe('1 tarefa')
  })

  it('a busca estreita comandos e tarefas juntos', () => {
    const items = buildItems(sample, 'reuniao')
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Reservar sala de reunião')
  })

  it('busca por status devolve as tarefas daquele status', () => {
    const items = buildItems(sample, 'aberta').filter((i) => i.kind === 'todo')
    expect(items.map((i) => i.label)).toEqual(['Escrever documentação da API'])
  })

  it('busca sem resultado devolve lista vazia, não erro', () => {
    expect(buildItems(sample, 'xyz')).toEqual([])
  })
})

describe('moveSelection', () => {
  it('dá a volta nas duas pontas', () => {
    expect(moveSelection(0, -1, 3)).toBe(2)
    expect(moveSelection(2, 1, 3)).toBe(0)
    expect(moveSelection(0, 1, 3)).toBe(1)
  })

  it('não divide por zero numa lista vazia', () => {
    expect(moveSelection(0, 1, 0)).toBe(0)
  })
})

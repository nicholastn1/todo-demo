import { STATUS_LABEL, countBy, type Filter, type Todo } from './todos'

export type PaletteItem =
  | { kind: 'filter'; id: string; label: string; hint: string; filter: Filter }
  | { kind: 'archive'; id: string; label: string; hint: string }
  | { kind: 'todo'; id: string; label: string; hint: string; todo: Todo }

const FILTER_ITEMS: { filter: Filter; label: string }[] = [
  { filter: 'all', label: 'Ver todas' },
  { filter: 'pending', label: 'Ver pendentes' },
  { filter: 'done', label: 'Ver concluídas' },
  { filter: 'archived', label: 'Ver arquivadas' },
]

/**
 * Accent- and case-insensitive. The titles and the status words are in
 * Portuguese, so "concluida" has to find "concluída" — a palette that only
 * matches the accented spelling is a palette nobody can type into quickly.
 */
export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export function matchesQuery(haystack: string, query: string) {
  return normalize(haystack).includes(normalize(query))
}

/** A todo is reachable by its title or by the word its status shows. */
export function todoMatches(todo: Todo, query: string) {
  return matchesQuery(todo.title, query) || matchesQuery(STATUS_LABEL[todo.status], query)
}

/**
 * Commands first, then the todos they act on. An empty query lists everything;
 * a query narrows both sections, and a section with no matches disappears
 * rather than showing an empty heading.
 */
export function buildItems(todos: Todo[], query: string): PaletteItem[] {
  const doneCount = countBy(todos, 'done')

  const filters: PaletteItem[] = FILTER_ITEMS.filter((f) => matchesQuery(f.label, query)).map(
    (f) => ({
      kind: 'filter',
      id: `filter:${f.filter}`,
      label: f.label,
      hint: 'seção',
      filter: f.filter,
    }),
  )

  const archive: PaletteItem[] =
    doneCount > 0 && matchesQuery('Arquivar concluídas', query)
      ? [
          {
            kind: 'archive',
            id: 'archive',
            label: 'Arquivar concluídas',
            hint: `${doneCount} tarefa${doneCount === 1 ? '' : 's'}`,
          },
        ]
      : []

  const matched: PaletteItem[] = todos
    .filter((t) => t.status !== 'archived')
    .filter((t) => todoMatches(t, query))
    .map((t) => ({
      kind: 'todo',
      id: `todo:${t.id}`,
      label: t.title,
      hint: STATUS_LABEL[t.status],
      todo: t,
    }))

  return [...filters, ...archive, ...matched]
}

/** Arrow keys wrap, so the list is navigable without looking at the edges. */
export function moveSelection(current: number, delta: number, length: number) {
  if (length === 0) return 0
  return (current + delta + length) % length
}

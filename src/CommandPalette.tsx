import { useEffect, useMemo, useRef, useState } from 'react'
import { buildItems, moveSelection, type PaletteItem } from './palette'
import type { Todo } from './todos'

type Props = {
  todos: Todo[]
  open: boolean
  onClose: () => void
  onFilter: (item: Extract<PaletteItem, { kind: 'filter' }>) => void
  onArchive: () => void
  onComplete: (todo: Todo) => void
}

export default function CommandPalette({
  todos,
  open,
  onClose,
  onFilter,
  onArchive,
  onComplete,
}: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  /**
   * Arrow keys scroll the list, which slides rows under a stationary cursor
   * and fires mouseenter on whatever lands there — snapping the selection back
   * and making the keyboard feel broken. Hover only counts once the pointer
   * has actually moved again.
   */
  const keyboardNav = useRef(false)

  const items = useMemo(() => buildItems(todos, query), [todos, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    inputRef.current?.focus()
  }, [open])

  // A query that shortens the list can leave the highlight past its end.
  useEffect(() => {
    setSelected((current) => (current >= items.length ? 0 : current))
  }, [items.length])

  // Keyboard navigation moves the highlight, not the scroll position, so the
  // selection walks out of the scrollable area without this. 'nearest' scrolls
  // the minimum needed, which also makes it a no-op when the mouse is what
  // moved the selection and the row is already visible.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const run = (item: PaletteItem) => {
    if (item.kind === 'filter') onFilter(item)
    if (item.kind === 'archive') onArchive()
    if (item.kind === 'todo') onComplete(item.todo)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      keyboardNav.current = true
      setSelected((c) => moveSelection(c, event.key === 'ArrowDown' ? 1 : -1, items.length))
      return
    }
    if (event.key === 'Enter' && items[selected]) {
      event.preventDefault()
      run(items[selected])
    }
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar tarefa, status ou comando..."
          aria-label="Buscar no palette"
        />

        <ul
          ref={listRef}
          className="palette__list"
          role="listbox"
          aria-label="Resultados"
          onMouseMove={() => {
            keyboardNav.current = false
          }}
        >
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                className="palette__item"
                role="option"
                aria-selected={i === selected}
                onMouseEnter={() => {
                  if (!keyboardNav.current) setSelected(i)
                }}
                onClick={() => run(item)}
              >
                <span>{item.label}</span>
                <span className="palette__hint">{item.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="palette__empty">Nada encontrado.</li>}
        </ul>

        <footer className="palette__footer">
          <span>↑↓ navegar</span>
          <span>↵ executar</span>
          <span>esc fechar</span>
        </footer>
      </div>
    </div>
  )
}

import { useState } from 'react'
import {
  addTodo,
  archiveDone,
  countBy,
  filterTodos,
  seed,
  toggleTodo,
  type Filter,
} from './todos'
import './App.css'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'done', label: 'Concluídas' },
  { key: 'archived', label: 'Arquivadas' },
]

export default function App() {
  const [todos, setTodos] = useState(seed)
  const [filter, setFilter] = useState<Filter>('all')
  const [title, setTitle] = useState('')

  const visible = filterTodos(todos, filter)

  return (
    <main className="app">
      <h1>Todo List</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setTodos(addTodo(todos, title))
          setTitle('')
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nova tarefa..."
          aria-label="Nova tarefa"
        />
        <button type="submit">Adicionar</button>
      </form>

      <nav className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={filter === f.key ? 'active' : ''}
          >
            {f.label}
          </button>
        ))}
        <button
          className="archive"
          onClick={() => setTodos(archiveDone(todos))}
          disabled={countBy(todos, 'done') === 0}
        >
          Arquivar concluídas ({countBy(todos, 'done')})
        </button>
      </nav>

      <ul>
        {visible.map((t) => (
          <li key={t.id} className={t.status}>
            <label>
              <input
                type="checkbox"
                checked={t.status !== 'pending'}
                disabled={t.status === 'archived'}
                onChange={() => setTodos(toggleTodo(todos, t.id))}
              />
              <span>{t.title}</span>
            </label>
          </li>
        ))}
        {visible.length === 0 && <li className="empty">Nada por aqui.</li>}
      </ul>

      <footer>
        {countBy(todos, 'pending')} pendentes · {countBy(todos, 'done')}{' '}
        concluídas · {countBy(todos, 'archived')} arquivadas
      </footer>
    </main>
  )
}

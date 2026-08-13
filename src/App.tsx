import { useEffect, useState } from 'react'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/archivo'
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

const TALLY = [
  ['pending', 'pendentes'],
  ['done', 'concluídas'],
  ['archived', 'arquivadas'],
] as const

const pad = (n: number) => String(n).padStart(2, '0')

export default function App() {
  const [todos, setTodos] = useState(seed)
  const [filter, setFilter] = useState<Filter>('all')
  const [title, setTitle] = useState('')

  // Rows stagger in once, on load. Changing a filter remounts them (the key
  // set changes), which would replay the stagger on every click — brief blank
  // rows that read as a broken render over compressed video, not as polish.
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 900)
    return () => clearTimeout(timer)
  }, [])

  const visible = filterTodos(todos, filter)
  const doneCount = countBy(todos, 'done')

  return (
    <div className="page">
      <aside className="rail">
        <header className="masthead">
          <p className="masthead__kicker">Registro de tarefas</p>
          <h1 className="masthead__title">
            Todo<span className="masthead__mark">.</span>
          </h1>
          <p className="masthead__meta">
            <span>Edição corrente</span>
            <span className="masthead__dot" aria-hidden="true" />
            <span>{todos.length} registros</span>
          </p>
        </header>

        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault()
            setTodos(addTodo(todos, title))
            setTitle('')
          }}
        >
          <input
            className="compose__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nova tarefa..."
            aria-label="Nova tarefa"
          />
          <button className="compose__submit" type="submit">
            Adicionar
          </button>
        </form>

        <nav className="filters" aria-label="Filtrar tarefas">
          <p className="filters__legend">Seções</p>
          <div className="filters__tabs">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className="filters__tab"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                <span>{f.label}</span>
                <span className="filters__count">
                  {/* not visible.length — that is the *filtered* list, so it
                      would report the active section's size under "Todas" */}
                  {f.key === 'all'
                    ? filterTodos(todos, 'all').length
                    : countBy(todos, f.key)}
                </span>
              </button>
            ))}
          </div>
          <button
            className="filters__archive"
            onClick={() => setTodos(archiveDone(todos))}
            disabled={doneCount === 0}
          >
            Arquivar concluídas
            <span className="filters__badge">{doneCount}</span>
          </button>
        </nav>

        <footer className="tally">
          {TALLY.map(([status, label]) => (
            <div className="tally__cell" key={status}>
              <span className="tally__num">{countBy(todos, status)}</span>
              <span className="tally__label">{label}</span>
            </div>
          ))}
        </footer>
      </aside>

      <main className="pane">
        <div className="pane__head">
          <span>Nº</span>
          <span>Tarefa</span>
          <span>Situação</span>
        </div>
        <ol className={intro ? 'ledger ledger--intro' : 'ledger'}>
          {visible.map((t, i) => (
            <li
              key={t.id}
              className={`ledger__row ${t.status}`}
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="ledger__index" aria-hidden="true">
                {pad(i + 1)}
              </span>
              <label className="ledger__label">
                <input
                  className="ledger__check"
                  type="checkbox"
                  checked={t.status !== 'pending'}
                  disabled={t.status === 'archived'}
                  onChange={() => setTodos(toggleTodo(todos, t.id))}
                />
                <span className="ledger__title">{t.title}</span>
              </label>
              <span className={`ledger__stamp ledger__stamp--${t.status}`}>
                {t.status === 'pending'
                  ? 'aberta'
                  : t.status === 'done'
                    ? 'concluída'
                    : 'arquivada'}
              </span>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="ledger__empty">Nenhum registro nesta seção.</li>
          )}
        </ol>
      </main>
    </div>
  )
}

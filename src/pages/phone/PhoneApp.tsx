/**
 * The phone shell. Three tabs, and the first one is a text box.
 *
 * §1's operative requirement is that the gap between a thought existing in a head and
 * existing on screen is near zero. On the device that is actually with you all day,
 * that requirement is the whole product — so capture is the default tab, the field is
 * focused on open, and there is nothing else on the screen to decide about.
 *
 * THE BOOT DIAGNOSTIC
 * -------------------
 * `bootstrap.ts` reports how the store came up. When it is durable, the tab bar shows
 * a small "on device" tag — quiet reassurance, once, where the eye already is. When it
 * is not, `App.tsx` shows the red banner instead; this file only renders the good case.
 */

import { useEffect, useRef, useState } from 'react'
import { addDays, atMinutes, localMidnight, now, fmtTime, fmtDate, MINUTE_MS } from '../../core/time'
import { useQuery, useStore } from '../../store/useStore'
import { TodayPage } from './TodayPage'
import type { Magnitude } from '../../core/types'

type Tab = 'capture' | 'today' | 'inbox'

const PERSISTING = 'persisting to on-device SQLite'

export function PhoneApp({ alarmsAvailable, diagnostic }: { alarmsAvailable: boolean; diagnostic: string }) {
  const [tab, setTab] = useState<Tab>('capture')
  const durable = diagnostic === PERSISTING

  return (
    <div className="phone">
      <main className="phone-body">
        {tab === 'capture' && <Capture />}
        {tab === 'today' && <TodayPage alarmsAvailable={alarmsAvailable} />}
        {tab === 'inbox' && <Inbox />}
      </main>

      {/* Bottom, not top: thumbs live at the bottom of a phone. */}
      <nav className="phone-tabs">
        <button className={tab === 'capture' ? 'on' : ''} onClick={() => setTab('capture')}>
          Capture
        </button>
        <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>
          Today
        </button>
        <button className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>
          Inbox
        </button>
        {durable && (
          <span className="durable-tag" title="data is stored in on-device SQLite">
            ● on device
          </span>
        )}
      </nav>
    </div>
  )
}

function Capture() {
  const store = useStore()
  const [text, setText] = useState('')
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const capture = () => {
    const title = text.trim()
    if (!title) return
    // A title and a timestamp is a valid node. No type, no span, no questions (§5.1).
    store.createNode({ title })
    setText('')
    setJustSaved(title)
    inputRef.current?.focus()
  }

  return (
    <div className="capture">
      <header className="phone-brand">
        <img src="/logo-icon.svg" alt="" className="brand-mark" />
        <div>
          <h1>Spatium Temporis</h1>
          <p>your time, mapped</p>
        </div>
      </header>

      <p className="capture-label">Quick Capture</p>
      <textarea
        ref={inputRef}
        value={text}
        placeholder="a thought, idea, task…"
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves; shift-enter is a newline. On a phone keyboard the return key
          // is right there under the thumb, which is the fastest path there is.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            capture()
          }
        }}
      />
      <div className="capture-actions">
        <button className="primary big" onClick={capture} disabled={!text.trim()}>
          Capture
        </button>
      </div>
      {/*
        Confirmation matters more here than on the desktop: the field empties on save,
        and without a receipt an empty box is ambiguous between "saved" and "lost".
      */}
      {justSaved && <p className="receipt">captured — {justSaved}</p>}

      {/* Quick Task Creator */}
      <QuickTaskCreator store={store} />
    </div>
  )
}

/**
 * Quick task creation with time picker - lets you schedule tasks on the phone.
 * This is the bridge between capture (no date) and scheduling (with time).
 */
function QuickTaskCreator({ store }: { store: ReturnType<typeof useStore> }) {
  const [title, setTitle] = useState('')
  const [hour, setHour] = useState('9')
  const [minute, setMinute] = useState('0')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const types = useQuery((s) => s.listNodeTypes())

  const createTask = () => {
    const titleText = title.trim()
    if (!titleText) return

    const h = parseInt(hour) || 9
    const m = parseInt(minute) || 0
    const startMs = atMinutes(now(), h * 60 + m) ?? localMidnight(now())
    const endMs = startMs + 60 * MINUTE_MS // Default 1 hour duration

    const node = store.createNode(
      {
        title: titleText,
        type: selectedType || null,
        magnitude: 'kilo',
      },
      {
        start_ms: startMs,
        start_precision: 'exact',
        end_ms: endMs,
        end_precision: 'exact',
      }
    )

    setTitle('')
    setHour('9')
    setMinute('0')
    setSelectedType(null)
    setJustCreated(node.title)
  }

  if (types.length === 0 && !selectedType) {
    return null // No types defined yet
  }

  return (
    <div className="quick-add">
      <p className="quick-add-title">Quick Task</p>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title..."
        className="time-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            createTask()
          }
        }}
      />

      <div className="time-picker-row">
        <label>at</label>
        <input
          type="time"
          value={`${hour}:${minute}`}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':')
            setHour(h)
            setMinute(m ?? '0')
          }}
          className="time-input"
        />
      </div>

      {types.length > 0 && (
        <div className="type-selector">
          {types.map((t) => (
            <button
              key={t.name}
              className={`type-chip${selectedType === t.name ? ' selected' : ''}`}
              onClick={() => setSelectedType(selectedType === t.name ? null : t.name)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <button
        className="primary"
        onClick={createTask}
        disabled={!title.trim()}
        style={{ marginTop: '8px' }}
      >
        Add Task
      </button>

      {justCreated && <p className="receipt">task added — {justCreated}</p>}
    </div>
  )
}

function Inbox() {
  const items = useQuery((s) => s.undated())
  const nowMs = now()

  return (
    <div className="phone-page">
      <section>
        <h2>Inbox</h2>
        <ul className="phone-list">
          {items.map((node) => (
            <li key={node.id}>
              <span className="what">{node.title}</span>
              <span className="when">{fmtDate(node.created_at)}</span>
            </li>
          ))}
          {items.length === 0 && <li className="empty">nothing waiting</li>}
        </ul>
        {/*
          Deliberately read-only. Giving something a date is scheduling, and scheduling
          is desktop work (§7) — a drag onto a timeline that does not exist here. The
          phone's job is that the thought stops being only in your head.
        */}
        <p className="notice">
          Dating and linking happen on the desktop. As of {fmtDate(nowMs)} these are
          waiting.
        </p>
      </section>
    </div>
  )
}

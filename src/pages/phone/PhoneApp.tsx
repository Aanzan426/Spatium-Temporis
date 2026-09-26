/**
 * The phone shell. Three tabs, and the first one is a text box.
 *
 * §1's operative requirement is that the gap between a thought existing in a head and
 * existing on screen is near zero. On the device that is actually with you all day,
 * that requirement is the whole product — so capture is the default tab, the field is
 * focused on open, and there is nothing else on the screen to decide about.
 *
 * IT MUST NEVER ASK FOR A CATEGORY, TYPE, PROJECT OR DATE (§5.1). Every field added
 * here is a reason to stop using the app, and on a phone, with one thumb, at a bus
 * stop, that is truer than anywhere else.
 */

import { useEffect, useRef, useState } from 'react'
import { fmtDate, now } from '../../core/time'
import { useQuery, useStore } from '../../store/useStore'
import { TodayPage } from './TodayPage'

type Tab = 'capture' | 'today' | 'inbox'

export function PhoneApp({ alarmsAvailable }: { alarmsAvailable: boolean }) {
  const [tab, setTab] = useState<Tab>('capture')

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
      <textarea
        ref={inputRef}
        value={text}
        placeholder="a thought…"
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
      <button className="primary big" onClick={capture} disabled={!text.trim()}>
        Capture
      </button>
      {/*
        Confirmation matters more here than on the desktop: the field empties on save,
        and without a receipt an empty box is ambiguous between "saved" and "lost".
      */}
      {justSaved && <p className="receipt">saved — {justSaved}</p>}
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

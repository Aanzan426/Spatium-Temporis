import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { boot } from './bootstrap'
import './styles.css'

/**
 * Boot before render, and await it.
 *
 * The store has to exist before the first render rather than arriving in an effect: a
 * page that renders empty and then fills in is a flash of "you have nothing", which on
 * an app that holds an entire inner life is an alarming thing to show someone every
 * launch. The wait is a few milliseconds locally.
 */
const { store, alarms, view, flush } = await boot()

/**
 * Flush queued writes when the app goes to the background — on Android that is the
 * moment before the OS may stop giving it CPU. `visibilitychange` rather than
 * `beforeunload`, which mobile browsers and WebViews do not reliably fire.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flush()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} alarms={alarms} view={view} />
  </StrictMode>,
)

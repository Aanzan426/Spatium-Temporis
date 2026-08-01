import { useState } from 'react'
import { MainPage } from './pages/main/MainPage'
import { SchedulerPage } from './pages/scheduler/SchedulerPage'

type Page = 'main' | 'scheduler'

export function App() {
  const [page, setPage] = useState<Page>('main')

  return (
    <>
      <nav>
        <button onClick={() => setPage('main')}>Timeline</button>
        <button onClick={() => setPage('scheduler')}>Scheduler</button>
      </nav>
      {page === 'main' ? <MainPage /> : <SchedulerPage />}
    </>
  )
}

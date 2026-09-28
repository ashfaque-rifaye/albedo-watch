import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Landing from './landing/Landing'

const MissionControl = lazy(() => import('./app/MissionControl'))

const isApp = location.pathname.startsWith('/app')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isApp ? (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#04060a' }} />}>
        <MissionControl />
      </Suspense>
    ) : <Landing />}
  </StrictMode>,
)

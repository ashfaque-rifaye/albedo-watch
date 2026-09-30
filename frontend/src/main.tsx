import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Landing from './landing/Landing'

const MissionControl = lazy(() => import('./app/MissionControl'))
const Legal = lazy(() => import('./legal/Legal'))

const isApp = location.pathname.startsWith('/app')
const legal = location.pathname.startsWith('/terms') ? 'terms' : location.pathname.startsWith('/privacy') ? 'privacy' : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legal ? <Suspense fallback={null}><Legal page={legal} /></Suspense> : isApp ? (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#04060a' }} />}>
        <MissionControl />
      </Suspense>
    ) : <Landing />}
  </StrictMode>,
)

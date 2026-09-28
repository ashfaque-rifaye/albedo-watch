import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Overview } from '../lib/api'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Logo, Wordmark } from '../components/Logo'
import { Globe } from './Globe'
import './landing.css'

const HeroEarth = lazy(() => import('./HeroEarth'))

/* Film with graceful fallback: if a clip is missing or can't autoplay, the
   animated backdrop underneath keeps the section alive. */
function Film({ src, className = '', dim = 0.45 }: { src: string; className?: string; dim?: number }) {
  const [ok, setOk] = useState(true)
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = v.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.play().catch(() => {}); else el.pause() }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  if (!ok) return null
  return (
    <>
      <video ref={v} className={`film ${className}`} src={src} muted loop playsInline preload="metadata" onError={() => setOk(false)} />
      <div className="film-dim" style={{ background: `rgba(4,6,10,${dim})` }} />
    </>
  )
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0.18 })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  })
}

/* Apple-style scroll-scrubbed statement: words light up as you scroll. */
function Statement({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [p, setP] = useState(0)
  useEffect(() => {
    const on = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const vh = window.innerHeight
      setP(Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35))))
    }
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const words = text.split(' ')
  return (
    <div ref={ref} className="statement display">
      {words.map((w, i) => <span key={i} style={{ opacity: 0.14 + 0.86 * Math.min(1, Math.max(0, p * words.length * 1.15 - i)) }}>{w} </span>)}
    </div>
  )
}

function Counter({ to, decimals = 0, prefix = '', suffix = '' }: { to: number | null | undefined; decimals?: number; prefix?: string; suffix?: string }) {
  const [v, setV] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (to == null || !ref.current) return
    const el = ref.current
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const step = (t: number) => { const k = Math.min(1, (t - t0) / 1400); setV(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step) }
      requestAnimationFrame(step)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [to])
  if (to == null) return <span ref={ref} className="count-wait" aria-label="loading" />
  return <span ref={ref}>{`${prefix}${fmt(v, decimals)}${suffix}`}</span>
}

const LOOP = [
  { k: 'Detect', t: 'Find the fires no monitor sees.', d: 'NASA VIIRS fire detections and citizen reports are scored against official monitoring coverage. What’s left are hidden hotspots — ranked by how many people live downwind.', film: '/media/fields.mp4', tag: 'Satellite × citizen' },
  { k: 'Trace', t: 'Follow the smoke home.', d: 'Seven air parcels run 48 hours backwards through the live wind field and meet the fires they crossed. Every city gets a transparent, explainable source breakdown.', film: '/media/fields.mp4', tag: 'Back-trajectories' },
  { k: 'Forecast', t: 'See the spike before it lands.', d: 'Hourly NAQI for 53 cities and six economic corridors, 72 hours ahead, with GRAP stage and lead time — corrected toward local reality by the federation.', film: '/media/city.mp4', tag: '72 h · 53 cities' },
  { k: 'Act', t: 'From forecast to order in one click.', d: 'Gemini drafts a GRAP-aligned order for the right authority and advisories in the state’s own languages — with a voice for IVR and radio. Humans approve every dispatch.', film: '/media/city.mp4', tag: 'Human in the loop' },
  { k: 'Learn', t: 'Weights travel. Data stays.', d: 'Each state trains on its own ground truth and shares only model weights. The federation beats every state going alone — even states with no data at all.', film: '/media/hero.mp4', tag: 'Federated learning' },
]

export default function Landing() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [step, setStep] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [earth, setEarth] = useState(false)
  const [earthReady, setEarthReady] = useState(false)
  useReveal()

  useEffect(() => {
    let alive = true, tries = 0
    const load = () => api.overview().then((o) => {
      if (!alive) return
      setOv(o)
      if ((!o.summary || !o.fires || !o.commons) && tries++ < 12) setTimeout(load, 5000)
    }).catch(() => { if (alive && tries++ < 12) setTimeout(load, 5000) })
    load()
    // the real Earth loads after first paint, desktop only (it is a 1 MB 3D engine)
    const t = setTimeout(() => { if (window.innerWidth > 760) setEarth(true) }, 900)
    if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 400)
    const on = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', on, { passive: true })
    return () => { alive = false; clearTimeout(t); window.removeEventListener('scroll', on) }
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.loop-step')
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.i)) }), { rootMargin: '-45% 0px -45% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const s = ov?.summary
  const m = ov?.commons ?? null
  const fires = ov?.fires?.count ?? null

  return (
    <div className="landing">
      <nav className={`lnav ${scrolled ? 'solid' : ''}`}>
        <a href="/" className="lbrand"><Logo size={34} /><Wordmark size={18} /></a>
        <div className="lnav-links">
          <a href="#loop">How it works</a>
          <a href="#citizens">Citizens</a>
          <a href="#commons">Federation</a>
          <a href="#stack">Built on Google</a>
        </div>
        <a className="btn btn-primary btn-sm" href="/app">Open Mission Control</a>
      </nav>

      {/* ---------------------------------------------------------- hero */}
      <header className="hero">
        <div className={`hero-globe ${earthReady ? 'fade' : ''}`}><Globe /></div>
        {earth && <Suspense fallback={null}><HeroEarth onReady={() => setEarthReady(true)} /></Suspense>}
        <Film src="/media/hero.mp4" dim={0.35} />
        <div className="hero-grad" />
        <div className="hero-inner">
          <div className="eyebrow fade-up" style={{ animationDelay: '.1s' }}>Built for India · Ready for every city on Earth</div>
          <h1 className="display hero-word fade-up" style={{ animationDelay: '.2s' }}>Albedo-Watch</h1>
          <p className="hero-sub fade-up" style={{ animationDelay: '.35s' }}>A citizen-powered air-intelligence network on a live 3D Earth.<br />Detect the hidden fire. Trace the smoke. Warn the city — before it breathes.</p>
          <div className="hero-cta fade-up" style={{ animationDelay: '.5s' }}>
            <a className="btn btn-primary" href="/app">Enter Mission Control →</a>
            <a className="btn btn-ghost" href="/app?mode=citizen">Report pollution</a>
          </div>
        </div>
        <div className="ticker glass fade-up" style={{ animationDelay: '.7s' }}>
          <span className="live-dot" />
          <span><b>{s ? s.cities : <i className="count-wait" />}</b> cities</span><i />
          <span><b>{s ? s.countries : <i className="count-wait" />}</b> countries</span><i />
          <span><b>{fires != null ? fmt(fires) : <i className="count-wait" />}</b> NASA heat detections · 24 h</span><i />
          <span><b>{ov?.sensors != null ? fmt(ov.sensors) : <i className="count-wait" />}</b> citizen sensors live</span>
        </div>
      </header>

      {/* ---------------------------------------------------- statement */}
      <section className="light sect" id="gap">
        <div className="wrap">
          <div className="eyebrow dark">The gap</div>
          <Statement text="India measures its air in a few hundred places. It breathes it in 1.4 billion. The planet is no different: the smoke that chokes a city is born in fields, forests, kilns and bylanes no monitor will ever see." />
        </div>
      </section>

      {/* --------------------------------------------------------- numbers */}
      <section className="sect numbers" id="numbers">
        <div className="wrap">
          <div className="sec-top" data-reveal>
            <div className="eyebrow">Live, right now</div>
            <h2 className="display h2">Not a dashboard of the past.<br /><span className="dim">A read on the next 72 hours.</span></h2>
          </div>
          <div className="big-grid">
            <div className="big" data-reveal><div className="big-n display"><Counter to={s?.pop_covered_m} suffix=" M" /></div><div className="big-l">people in {s?.cities ?? '…'} cities across {s?.countries ?? '…'} countries get an hourly, 72-hour air forecast — {s?.spikes_72h ?? '…'} of those cities are heading into unhealthy air right now</div></div>
            <div className="big" data-reveal><div className="big-n display" style={{ color: 'var(--ember)' }}><Counter to={fires} /></div><div className="big-l">satellite heat detections worldwide in the last 24 hours (NASA VIIRS) — {ov?.fires ? fmt(ov.fires.large) : '…'} of them intense fires</div></div>
            <div className="big" data-reveal><div className="big-n display" style={{ color: 'var(--albedo)' }}><Counter to={m ? m.improvement_pct : null} prefix="−" suffix="%" decimals={1} /></div><div className="big-l">forecast error once {m?.nodes ?? '…'} states & countries federate — without sharing a byte of raw data</div></div>
            <div className="big" data-reveal><div className="big-n display" style={{ color: '#9ccc3a' }}><Counter to={ov?.sensors ?? null} /></div><div className="big-l">open citizen air sensors streaming right now, fused with satellites and forecasts</div></div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ loop */}
      <section className="sect loop" id="loop">
        <div className="wrap loop-grid">
          <div className="loop-sticky">
            <div className="loop-visual">
              <div className="aurora" />
              {LOOP.map((l, i) => (
                <div key={l.k} className={`loop-film ${i === step ? 'on' : ''}`}><Film src={l.film} dim={0.25} /></div>
              ))}
              <div className="loop-card glass">
                <div className="eyebrow">{String(step + 1).padStart(2, '0')} · {LOOP[step].k}</div>
                <div className="display" style={{ fontSize: 26, marginTop: 6 }}>{LOOP[step].tag}</div>
                <div className="loop-dots">{LOOP.map((l, i) => <i key={l.k} className={i === step ? 'on' : ''} />)}</div>
              </div>
            </div>
          </div>
          <div className="loop-steps">
            <div className="eyebrow">The loop</div>
            <h2 className="display h2" style={{ marginBottom: 40 }}>Detect. Trace. Forecast.<br />Act. Learn.</h2>
            {LOOP.map((l, i) => (
              <div key={l.k} className={`loop-step ${i === step ? 'on' : ''}`} data-i={i}>
                <div className="loop-k mono">{String(i + 1).padStart(2, '0')} — {l.k}</div>
                <h3 className="display">{l.t}</h3>
                <p>{l.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- citizens */}
      <section className="sect citizens" id="citizens">
        <Film src="/media/citizen.mp4" dim={0.55} />
        <div className="wrap cit-grid">
          <div data-reveal>
            <div className="eyebrow">1.4 billion sensors</div>
            <h2 className="display h2">Speak in Punjabi.<br />Snap a photo.<br /><span className="dim">Gemini does the rest.</span></h2>
            <p className="lead">A farmer in Sangrur, a student in Patna, a nurse in Chennai — anyone can report smoke in their own language. Gemini reads the photo, transcribes the voice note, and checks it against satellites and neighbours before it reaches the official who can act. The reply comes back in the language it was sent in.</p>
            <div className="lang-cloud">{['ਪੰਜਾਬੀ', 'हिन्दी', 'বাংলা', 'தமிழ்', 'తెలుగు', 'मराठी', 'ગુજરાતી', 'ಕನ್ನಡ', 'മലയാളം', 'ଓଡ଼ିଆ', 'اردو', 'অসমীয়া'].map((l) => <span key={l}>{l}</span>)}</div>
          </div>
          <div className="phone-mock" data-reveal>
            <div className="pm-screen">
              <div className="pm-top mono">Albedo-Watch · Report</div>
              <div className="pm-photo"><div className="pm-smoke" /><span className="pm-tag">Crop-residue burning · severity 4/5</span></div>
              <div className="pm-row"><span className="status s-verified">verified · 82</span><span className="muted mono" style={{ fontSize: 11 }}>VIIRS fire 1.8 km · 3 h ago</span></div>
              <div className="pm-route">→ District Collector (Agriculture) + PPCB</div>
              <div className="bubble" style={{ fontSize: 13 }}>ਧੰਨਵਾਦ ਜੀ! ਤੁਹਾਡੀ ਸੂਚਨਾ ਸਬੰਧਤ ਅਧਿਕਾਰੀ ਨੂੰ ਭੇਜ ਦਿੱਤੀ ਗਈ ਹੈ। ਬਾਹਰ ਜਾਣ ਵੇਲੇ ਮਾਸਕ ਪਾਓ।</div>
              <div className="pm-foot mono">✦ Gemini 3.7 Flash · illustrative example</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- commons */}
      <section className="sect" id="commons">
        <div className="wrap">
          <div className="sec-top" data-reveal>
            <div className="eyebrow">The Model Commons</div>
            <h2 className="display h2">Weights travel.<br /><span className="dim">Data stays home.</span></h2>
          </div>
          <div className="bento">
            <div className="b b-wide" data-reveal>
              <div className="eyebrow">Why federate</div>
              <p className="b-big">Global forecasts are blind to local reality — and the error is different in every region: they over-read the Indo-Gangetic plain, under-read others. Each state and country holds the truth for its own air. Albedo-Watch lets them learn together without surrendering it.</p>
            </div>
            <div className="b" data-reveal><div className="b-n display"><Counter to={m?.nodes} /></div><div className="b-l">states & countries in {m?.federations ? Object.keys(m.federations).length : '…'} regional federations</div></div>
            <div className="b" data-reveal><div className="b-n display" style={{ color: 'var(--wind)' }}><Counter to={m?.zero_data_improvement_pct} prefix="−" suffix="%" decimals={1} /></div><div className="b-l">error for a place that contributes <b>no data</b> — it borrows its federation</div></div>
            <div className="b" data-reveal><div className="b-n display"><Counter to={m ? m.mae_personalised : null} decimals={1} /></div><div className="b-l">µg/m³ error, federated + personalised — better than going alone ({m?.mae_local ?? '…'}) or the global model ({m?.mae_cams ?? '…'})</div></div>
            <div className="b b-glyph" data-reveal>
              <div className="hex">⬡</div>
              <div className="b-l">Open Air Event Protocol · CC-BY model weights · designed as a Digital Public Good, ready for BRICS partners from São Paulo to Jakarta.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ stack */}
      <section className="sect light" id="stack">
        <div className="wrap">
          <div className="sec-top" data-reveal>
            <div className="eyebrow dark">Built on Google AI</div>
            <h2 className="display h2" style={{ color: '#0b0d12' }}>Every step does real work.</h2>
          </div>
          <div className="stack-grid">
            {[
              ['Gemini 3.7 Flash', 'Reads citizen photos & voice notes in any Indian language, verifies authenticity, explains sources, drafts GRAP orders.'],
              ['Gemini TTS', 'Turns every advisory into a natural voice for IVR helplines and community radio.'],
              ['Google Maps Platform', 'Air Quality history as federated ground truth; Geocoding to route every report to the right district.'],
              ['Cloud Run + Firestore', 'One stateless container, scales to zero; reports and the action ledger persist in Firestore.'],
              ['NASA FIRMS · CAMS', 'Open satellite fire detections and global composition forecasts — the public data the network stands on.'],
              ['Federated learning', 'FedAvg with state personalisation and optional differential privacy — sovereign by design.'],
            ].map(([t, d]) => <div key={t} className="stack-item" data-reveal><h4>{t}</h4><p>{d}</p></div>)}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- cta */}
      <section className="sect final" id="final">
        <Film src="/media/city.mp4" dim={0.55} />
        <div className="wrap" style={{ textAlign: 'center', position: 'relative' }}>
          <h2 className="display final-h" data-reveal>Every breath,<br />traced.</h2>
          <div className="hero-cta" style={{ justifyContent: 'center' }}>
            <a className="btn btn-primary" href="/app">Enter Mission Control →</a>
            <a className="btn btn-ghost" href="/app?mode=commons">See the federation</a>
          </div>
        </div>
      </section>

      <footer className="lfoot">
        <div className="wrap lfoot-in">
          <div className="lbrand"><Logo size={26} /><Wordmark size={16} /></div>
          <p>Prototype for Build with AI: Code for Communities (2nd ed.). Forecasts and attributions are model estimates, clearly labelled; not official CPCB bulletins. Data: CAMS via Open-Meteo, NASA FIRMS, Google Air Quality & Geocoding. Station counts approximate.</p>
        </div>
      </footer>
    </div>
  )
}

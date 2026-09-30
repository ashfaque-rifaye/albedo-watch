import { Logo, Wordmark } from '../components/Logo'
import './legal.css'

const UPDATED = '1 October 2026'

function Terms() {
  return (
    <>
      <h1>Terms of use</h1>
      <p className="upd">Last updated {UPDATED}</p>
      <p>Albedo-Watch is a working prototype built for <i>Build with AI: Code for Communities</i> (2nd edition). By using it you agree to these terms.</p>

      <h2>What the numbers are</h2>
      <p>Forecasts, source attributions, hotspot grades, health and rupee values are <b>model estimates</b>, labelled as such. They are not official bulletins of the CPCB, a State Pollution Control Board or any government. Do not rely on Albedo-Watch for medical decisions or emergencies.</p>

      <h2>Google Maps</h2>
      <p>This app includes Google Maps features and content: Google satellite and map tiles, Photorealistic 3D Tiles, live air quality from the Air Quality API, and Street View. Your use of Google Maps features and content is subject to the then-current versions of the <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">Google Maps/Google Earth Additional Terms of Service</a> and the <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>. In the <b>Open data</b> map mode all Google Maps features are switched off.</p>

      <h2>AI features</h2>
      <p>Summaries, answers, source explanations, orders and advisories are written by Google Gemini and can be wrong. Nothing is sent to an authority by the AI: every order waits for a person to approve it, and sending is simulated in this prototype. Spoken replies use Gemini's text-to-speech voice. The films on the home page were generated with Veo in Google Flow and are labelled as AI-generated.</p>

      <h2>Who may use it</h2>
      <p>Albedo-Watch is intended for adults (18 and over), in line with the Gemini API terms. It is built for India; if you are in the European Economic Area, the UK or Switzerland, please do not use the Copilot or submit reports.</p>

      <h2>Citizen reports</h2>
      <p>Only report what you have seen. Do not submit other people's faces, names, phone numbers or other personal details, false reports, or harmful content. When you submit a report you allow Albedo-Watch to analyse it with Google Gemini and to show a small thumbnail, its location and the AI summary to other users. Reports may be removed at any time.</p>

      <h2>Open data</h2>
      <p>Albedo-Watch also uses NASA FIRMS and GIBS, Copernicus CAMS and weather via Open-Meteo (CC BY 4.0), OpenAQ, Sensor.Community, OpenStreetMap (© OpenStreetMap contributors, ODbL), GDELT, and Esri imagery in the Open data mode. Each source is credited where it appears.</p>

      <h2>No warranty</h2>
      <p>The prototype is provided as is, without warranty, and may change or go offline at any time.</p>
    </>
  )
}

function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p className="upd">Last updated {UPDATED}</p>
      <p>Albedo-Watch collects as little as it can. There are no accounts, no advertising and no analytics trackers.</p>

      <h2>Your location</h2>
      <p>Only when you tap <b>Use my location</b> or <b>My location</b>, and only after your browser asks you. Our server uses it to fetch air data for that point from Google Maps (Air Quality, rounded to about 100 m), Copernicus CAMS via Open-Meteo, OpenAQ and OpenStreetMap. Your "hub" is stored in your own browser; tap <b>change</b> to clear it.</p>

      <h2>Air alerts (opt-in)</h2>
      <p>If you turn on alerts we store your browser's push address, your hub (rounded to about 100 m), the health profile you chose and the place name in Google Cloud Firestore, to check the forecast every two hours. Tap <b>Turn off</b> to delete them.</p>

      <h2>Citizen reports (opt-in)</h2>
      <p>Your photo, voice note, text and the location you choose are sent to the Google Gemini API for analysis. We keep a small thumbnail, the location, the AI summary and transcript, and the office it was routed to, and show them to other users. Depending on the service tier, Google may use content sent to the Gemini API to improve its products, so please leave out sensitive or personal information.</p>

      <h2>Questions to the Copilot</h2>
      <p>Your question is sent to the Google Gemini API to answer it. We do not store the conversation. Orders it drafts are saved in the action ledger.</p>

      <h2>Services your browser contacts directly</h2>
      <p>Map imagery comes straight from Google Maps (or from Esri and NASA in the Open data mode), Street View from Google's Maps Embed API, and fonts from Google Fonts. These providers receive your IP address under their own policies, including the <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>.</p>

      <h2>Logs and storage</h2>
      <p>Our server logs each request (path, status, time, and your IP address for rate limiting) in Google Cloud Logging. The app stores a few settings in your browser (your hub, country, profile, whether you have seen the tour). It sets no cookies of its own.</p>

      <h2>Children</h2>
      <p>Albedo-Watch is not directed at people under 18.</p>

      <h2>Your choices</h2>
      <p>Choose a country instead of sharing your location, turn alerts off at any time, and ask through the project's repository for a report to be removed.</p>
    </>
  )
}

export default function Legal({ page }: { page: 'terms' | 'privacy' }) {
  document.title = page === 'terms' ? 'Terms of use · Albedo-Watch' : 'Privacy · Albedo-Watch'
  return (
    <div className="legal">
      <header><a href="/" className="lbrand" aria-label="Albedo-Watch home"><Logo size={30} animated={false} /><Wordmark size={17} /></a>
        <nav><a href="/terms" className={page === 'terms' ? 'on' : ''}>Terms</a><a href="/privacy" className={page === 'privacy' ? 'on' : ''}>Privacy</a><a href="/app">Open the app</a></nav></header>
      <main>{page === 'terms' ? <Terms /> : <Privacy />}</main>
    </div>
  )
}

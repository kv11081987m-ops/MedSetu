import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from "@sentry/react"
import './index.css'
import App from './App.jsx'

// Error monitoring only — no tracing, no session replay, no user context.
// beforeSend strips every field that could carry a prescription URL, phone,
// email, or health detail before the event leaves the browser.
Sentry.init({
  dsn: "https://abe295b710941443c312dab908721f44@o4511999772852224.ingest.us.sentry.io/4511999884394496",
  environment: import.meta.env.MODE,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) { delete event.request.query_string; delete event.request.data; delete event.request.cookies; }
    if (event.user)    { delete event.user.email; delete event.user.username; delete event.user.ip_address; }
    return event;
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

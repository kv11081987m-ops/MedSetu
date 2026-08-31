import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from "@sentry/react"
import './index.css'
import App from './App.jsx'

// Error monitoring only — no tracing, no session replay, no user context.
// beforeSend + beforeBreadcrumb strip every field that could carry a
// prescription path, phone, email, OAuth token, or health detail before
// the event leaves the browser.

// Redact free-text PII that Supabase/GoTrue error strings echo back
// (e.g. "Phone number 919999999999 already registered", "...email x@y.z...").
const PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // email
  /\+?\d[\d\s().-]{8,}\d/g,                           // phone / any 10+ digit run
];
const scrubPii = (str) =>
  typeof str === 'string'
    ? PII_PATTERNS.reduce((s, re) => s.replace(re, '[redacted]'), str)
    : str;
const stripUrl = (u) => (typeof u === 'string' ? u.split(/[?#]/)[0] : u);

Sentry.init({
  dsn: "https://abe295b710941443c312dab908721f44@o4511999772852224.ingest.us.sentry.io/4511999884394496",
  environment: import.meta.env.MODE,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      delete event.request.query_string;
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      // query + hash carry the OAuth ?code= / #access_token= credential
      if (event.request.url) event.request.url = stripUrl(event.request.url);
    }
    // no user context at all — id included
    delete event.user;
    // Supabase error messages can name a phone/email — redact in-place
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubPii(ex.value);
      }
    }
    if (event.message) event.message = scrubPii(event.message);
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    // console breadcrumbs echo error.details (Postgres "Failing row contains
    // (...)" with phone/address/lat-lng) — drop them entirely.
    if (breadcrumb.category === 'console') return null;
    // fetch/xhr/navigation URLs carry ?col=eq.<uuid/phone> and #access_token=
    if (breadcrumb.data) {
      if (breadcrumb.data.url)  breadcrumb.data.url  = stripUrl(breadcrumb.data.url);
      if (breadcrumb.data.to)   breadcrumb.data.to   = stripUrl(breadcrumb.data.to);
      if (breadcrumb.data.from) breadcrumb.data.from = stripUrl(breadcrumb.data.from);
    }
    return breadcrumb;
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

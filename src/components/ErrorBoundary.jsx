import { Component } from 'react';

// Top-level render-crash guard — without this, any uncaught error in a
// screen's render (bad API shape, null-deref) white-screens the whole app
// with no recovery path. Must be a class component: only
// getDerivedStateFromError/componentDidCatch can catch render errors —
// there is no hook equivalent.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={s.wrapper}>
          <p style={s.text}>Kuch galat ho gaya — app reload karein</p>
          <button style={s.btn} onClick={() => window.location.reload()}>
            Reload Karo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const s = {
  wrapper: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', backgroundColor: '#F5F5F5', padding: '24px', textAlign: 'center' },
  text:    { fontSize: '14px', color: '#1A1A1A', fontWeight: '600', margin: 0 },
  btn:     { padding: '14px 28px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
};

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { LanguageProvider } from './context/LanguageContext';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { CartProvider } from './context/CartContext';

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Hotel Darshan frontend runtime error:', error, info); }
  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error);
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#fafafa', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ width: '100%', maxWidth: 620, background: '#fff', border: '1px solid #fecaca', borderRadius: 20, padding: 28, boxShadow: '0 20px 50px rgba(0,0,0,.08)' }}>
            <h1 style={{ margin: 0, color: '#b91c1c', fontSize: 22 }}>Hotel Darshan could not load</h1>
            <p style={{ color: '#4b5563', marginTop: 10 }}>A frontend runtime error stopped React from rendering. Open the browser console for the full stack trace.</p>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#fef2f2', color: '#991b1b', padding: 14, borderRadius: 12, overflow: 'auto', fontSize: 12 }}>{message}</pre>
            <button onClick={() => window.location.reload()} style={{ marginTop: 12, border: 0, borderRadius: 10, padding: '10px 16px', background: '#e53935', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Reload app</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <AppErrorBoundary>
    {/* The router lives above the error boundary's providers so that a URL
        reload restores the requested route rather than a cached one. The
        boundary stays inside it, so a runtime error still renders its own
        recovery screen instead of blanking the app. */}
    <BrowserRouter>
      <StrictMode>
      <LanguageProvider>
        <AuthProvider>
          <SocketProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </SocketProvider>
        </AuthProvider>
      </LanguageProvider>
      </StrictMode>
    </BrowserRouter>
  </AppErrorBoundary>,
);

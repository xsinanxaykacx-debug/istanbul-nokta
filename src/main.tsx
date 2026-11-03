import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><Analytics /></React.StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) { window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); }); }

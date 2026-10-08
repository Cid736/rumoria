import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { startEngine } from './player/engine.js';
import { startSession } from './player/session.js';
import { usePerf } from './store/perf.js';
import './styles/tokens.css';
import './styles/app.css';
import './styles/look.css';
import './styles/v15.css';

// Your performance profile first (it decides how much is done ahead), then
// the queue kept from last time, then the player that follows it.
usePerf.getState().apply();
startSession();
startEngine();
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

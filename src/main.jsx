import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { startEngine } from './player/engine.js';
import { startSession } from './player/session.js';
import { startPodcastProgress } from './store/podcasts.js';
import { usePerf } from './store/perf.js';
import './styles/tokens.css';
import './styles/app.css';
import './styles/look.css';
import './styles/v15.css';
import './styles/ui.css';
import './styles/backgrounds.css';
import './styles/v17.css';
import './styles/v18.css';
import './styles/phone.css';
import './styles/podcasts.css';

// Your performance profile first (it decides how much is done ahead), then
// the queue kept from last time, then the player that follows it.
usePerf.getState().apply();
startSession();
startEngine();
// v1.13: where you are in each episode, saved as you listen.
startPodcastProgress();
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

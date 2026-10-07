import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { startEngine } from './player/engine.js';
import './styles/tokens.css';
import './styles/app.css';
import './styles/look.css';

startEngine();
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { PhonePage } from './panels/Phone';
import { PopoutPage } from './popout';
const q = new URLSearchParams(location.search), phone = q.get('phone'), view = q.get('view');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{phone ? <PhonePage room={phone} /> : view ? <PopoutPage view={view} /> : <App />}</React.StrictMode>);

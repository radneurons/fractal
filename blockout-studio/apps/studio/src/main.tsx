import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { PhonePage } from './panels/Phone';
const phone = new URLSearchParams(location.search).get('phone');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{phone ? <PhonePage room={phone} /> : <App />}</React.StrictMode>);

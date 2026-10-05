import React from 'react';
import { createRoot } from 'react-dom/client';
import '@guardian/stand/fonts/OpenSans.css';
import '@guardian/stand/fonts/MaterialSymbolsOutlined.css';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

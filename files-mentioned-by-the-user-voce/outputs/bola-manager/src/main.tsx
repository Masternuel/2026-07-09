import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles.css';
import './styles/entry.css';
import './styles/layout.css';
import './styles/dashboard.css';
import './styles/squad.css';
import './styles/tactics.css';
import './styles/match.css';
import './styles/press-conference.css';
import './styles/season.css';
import './styles/club.css';
import './styles/media.css';
import './styles/responsive.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

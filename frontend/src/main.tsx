import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { GoogleAuthProvider } from './context/GoogleAuthContext';
import './styles.css';
import './chat.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <GoogleAuthProvider><App /></GoogleAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { installStaleReleaseRecovery } from './runtimeRecovery'
import { AppProvider } from './state/AppContext'
import './styles.css'
import './supportSchedule.css'

installStaleReleaseRecovery()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </StrictMode>,
)

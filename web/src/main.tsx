import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './panel.css'
import './landing.css'
import App from './App.tsx'
import { Landing } from './landing/Landing.tsx'

// "/" is the landing page and "/demo" the stage. Old stage links ("/?mock=1", "/?chain=31337") still
// open the stage, so the backup tab from the rehearsal checklist keeps working.
const params = new URLSearchParams(window.location.search)
const stage = window.location.pathname.startsWith('/demo') || params.has('mock') || params.has('chain')

createRoot(document.getElementById('root')!).render(<StrictMode>{stage ? <App /> : <Landing />}</StrictMode>)

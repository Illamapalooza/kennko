import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/nunito'
import '@kennko/tokens/tokens.css'
import './styles.css'
import { App } from './App.tsx'
import { startPwa } from './pwa.ts'

startPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

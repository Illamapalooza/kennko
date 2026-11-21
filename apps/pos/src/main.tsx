import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/nunito'
import '@kennko/tokens/tokens.css'
import '@kennko/cats/cats.css'
import './styles.css'
import { App } from './App.tsx'
import { startPwa } from './pwa.ts'

async function main() {
  if (import.meta.env.VITE_TILL === 'app') {
    const { bootApp } = await import('./app/boot.ts')
    await bootApp()
  } else {
    startPwa()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

main()

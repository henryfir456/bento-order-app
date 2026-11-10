import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generate } from './scripts/generate-dependency-health.mjs'

// Runs inside `vite build` itself, so it works whatever build command Netlify uses.
const isStale = (file) => {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data.status !== 'ready' || Date.now() - new Date(data.generatedAt).getTime() > 24 * 3600 * 1000
  } catch { return true }
}

const dependencyHealth = () => {
  let command = 'build'
  return {
    name: 'dependency-health',
    configResolved(config) { command = config.command },
    // Always refresh on build. `vite dev` never builds, so it regenerates only when the file is missing, failed last time, or is over a day old (fast restarts).
    async buildStart() {
      const root = fileURLToPath(new URL('.', import.meta.url))
      if (command === 'build' || isStale(`${root}src/generated/dependency-health.json`)) await generate(root)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dependencyHealth(),
  ],
  server: {
    host: true, // 允許外網連線
    allowedHosts: ['.run.pinggy-free.link'], // Allow rotating Pinggy subdomains via Vite's leading-dot syntax (not literal *).
  }
})


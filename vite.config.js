import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true, // 允許外網連線
    allowedHosts: ['.run.pinggy-free.link'], // Allow rotating Pinggy subdomains via Vite's leading-dot syntax (not literal *).
  }
})


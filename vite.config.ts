import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: "/lightning-chess-folder-reorg/",
  plugins: [react()],
})
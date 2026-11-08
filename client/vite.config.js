import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['ollama/browser'],
    exclude: ['@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    watch: usePolling ? { usePolling: true } : undefined,
  },
  preview: {
    host: true,
  },
})

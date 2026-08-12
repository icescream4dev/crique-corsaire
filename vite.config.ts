import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      ignored: ['**/.venv*/**', '**/node_modules/**', '**/__pycache__/**'],
    },
  },
});

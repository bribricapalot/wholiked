import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    // Lets friends join through a Cloudflare quick tunnel (see "Tunnel starten.cmd").
    allowedHosts: ['.trycloudflare.com'],
    // Same-origin in dev so the session cookie works for OAuth + sockets.
    proxy: {
      '/socket.io': { target: api, ws: true },
      '/auth': api,
      '/api': api,
    },
  },
});

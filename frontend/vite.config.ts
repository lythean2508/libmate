import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { libmateAIPlugin } from './server/ai';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['GEMINI_', 'GOOGLE_CLIENT_ID']);
  return {
  plugins: [react(), libmateAIPlugin({ apiKey: env.GEMINI_API_KEY || '', googleClientId: env.GOOGLE_CLIENT_ID || '', model: env.GEMINI_MODEL })],
  server: {
    port: 5173,
    host: true,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
  },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
  };
});

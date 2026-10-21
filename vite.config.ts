import { readFileSync, cpSync } from 'node:fs';
import { defineConfig } from 'vite';

// Keep the imported entry canonical for the existing tests and static baseline.
export default defineConfig({
  publicDir: false,
  server: {
    proxy: {
      '/api': { target: process.env.ITSM_DEV_API_URL || 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  plugins: [{
    name: 'opendesign-react-entry',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename.endsWith('/index.html')) return html;
        const original = readFileSync('index.html', 'utf8');
        const head = original.slice(0, original.indexOf('<body>'))
          .replace(/  <script src="assets\/js\/(theme|sidebar)\.js"><\/script>\n/g, '');
        return `${head}<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
      },
    },
    closeBundle() {
      // Dynamic legacy URLs, fonts, maps and export resources must stay stable.
      cpSync('assets', 'dist/assets', { recursive: true });
    },
  }, {
    name: 'opendesign-early-preferences',
    transformIndexHtml: {
      order: 'post',
      handler: (_html, context) => context.filename.endsWith('/index.html') ? ['theme', 'sidebar'].map(name => ({
        tag: 'script', attrs: { src: `./assets/js/${name}.js` }, injectTo: 'head-prepend' as const,
      })) : [],
    },
  }],
});

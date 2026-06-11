import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
              return 'vendor';
            }
            if (id.includes('@supabase')) {
              return 'supabase';
            }
            if (id.includes('lucide-react')) {
              return 'icons';
            }
          },
        },
      },
    },
    plugins: [
      react(),
      {
        name: 'dev-sms-api',
        configureServer(server) {
          server.middlewares.use('/api/send-otp', (req, res, next) => {
            if (req.method !== 'POST') { next(); return; }

            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const { phone, otp } = JSON.parse(body);
                console.log('[SMS] Phone:', phone, '| OTP:', otp, '| API Key set:', !!env.VITE_FAST2SMS_API_KEY);
                const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                  method: 'POST',
                  headers: {
                    'authorization': env.VITE_FAST2SMS_API_KEY,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    route: 'otp',
                    variables_values: otp,
                    numbers: phone,
                  }),
                });
                const data = await response.json();
                console.log('[SMS API Response]', JSON.stringify(data));
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              } catch (error) {
                res.statusCode = 500;
                res.end(JSON.stringify({ return: false, error: error.message }));
              }
            });
          });
        },
      },
    ],
  };
});

// vite.config.js
import { defineConfig } from 'vite';
import { resolve }      from 'path';

export default defineConfig({

    appType: 'mpa',

    server: {
        open: '/dev/editor.html', // npm run dev → abre el editor
    },

    build: {
        rollupOptions: {
            input: {
                // Producción: solo el entry real. /dev/ no se publica.
                main: resolve(__dirname, 'index.html'),
            },
        },
    },
});
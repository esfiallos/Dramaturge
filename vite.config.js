// vite.config.js
import { defineConfig } from 'vite';
import { resolve }      from 'path';


// En GitHub Pages el juego se sirve desde /Dramaturge/ (nombre del repo).
// En desarrollo y en un dominio propio se sirve desde /.
// La variable VITE_BASE permite sobreescribir esto si el repo tiene otro nombre
// o si se despliega en un dominio propio con CNAME.
const base = process.env.VITE_BASE ?? '/Dramaturge/';

export default defineConfig({

    appType: 'mpa',

    // En producción (build) se aplica el base para GitHub Pages.
    // En desarrollo (dev) siempre usa '/' para que las rutas locales funcionen.
    base: process.env.NODE_ENV === 'production' ? base : '/',

    server: {
        open: '/dev/editor.html', // npm run dev → abre el editor
    },

    build: {
        rollupOptions: {
            input: {
                // Solo el entry de producción. /dev/ no se publica.
                main: resolve(__dirname, 'index.html'),
            },
        },
    },
});
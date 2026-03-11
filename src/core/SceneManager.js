// src/core/SceneManager.js
//
// RESPONSABILIDADES:
//   - Cargar archivos .dan desde /public/scripts/ vía fetch
//   - Parsear el script y entregarlo al Engine
//   - Ser el handler de goto (inyectado como engine.sceneLoader)
//
// CICLO DE VIDA:
//   1. main.js crea: const sceneManager = new SceneManager(engine, parser)
//   2. Inyecta:      engine.sceneLoader = (t) => sceneManager.goto(t)
//   3. Inicia:       await sceneManager.start('cap01/scene_01')
//
// CONVENCIÓN DE RUTAS:
//   target 'cap01/scene_02' → fetch('/scripts/cap01/scene_02.dan')
//   target 'intro'          → fetch('/scripts/intro.dan')
//
// En producción (GitHub Pages) Vite inyecta BASE_URL = '/Dramaturge/' automáticamente.
// En desarrollo BASE_URL = '/'. No hay que cambiar nada al desplegar.
//
// El SceneManager NO conoce al Renderer ni al Audio.
// Solo coordina Engine + Parser + sistema de archivos.

export class SceneManager {

    /**
     * @param {Dramaturge} engine   - Instancia del motor
     * @param {KParser}     parser   - Instancia del parser
     * @param {string}      basePath - Ruta base de los scripts (default: '/scripts/')
     */
    constructor(engine, parser, basePath = `${import.meta.env.BASE_URL}scripts/`) {
        this.engine   = engine;
        this.parser   = parser;
        this.basePath = basePath;

        // Caché en memoria: target → instrucciones ya parseadas
        // Evita re-fetchear y re-parsear una escena visitada más de una vez
        this._cache = new Map();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Carga la escena de inicio y arranca la ejecución.
     * Llamar una sola vez desde main.js después de renderer.init().
     * @param {string} startTarget - ej: 'cap01/scene_01'
     */
    async start(startTarget) {
        console.log(`[SceneManager] Iniciando desde "${startTarget}".`);
        await this._loadAndRun(startTarget);
    }

    /**
     * Navega a otra escena.
     * Inyectado en engine.sceneLoader = (t) => sceneManager.goto(t)
     * @param {string} target - ej: 'cap01/scene_02'
     */
    async goto(target) {
        console.log(`[SceneManager] goto → "${target}".`);
        await this._loadAndRun(target);
    }

    /**
     * Carga e instala el script en el engine SIN ejecutarlo.
     * Usar para "Continuar" — después llamar engine.next() manualmente.
     * @param {string} target
     * @returns {boolean} true si se cargó correctamente
     */
    async loadOnly(target) {
        let instructions = this._cache.get(target);

        if (!instructions) {
            const raw = await this._fetch(target);
            if (!raw) return false;
            instructions = this.parser.parse(raw);
            this._cache.set(target, instructions);
        }

        this.engine.state.currentFile = `${target}.dan`;
        await this.engine.loadScript(instructions);
        return true;
    }

    /**
     * Precarga una escena en caché sin ejecutarla.
     * Útil para precargar la siguiente escena mientras el jugador lee la actual.
     * @param {string} target
     */
    async prefetch(target) {
        if (this._cache.has(target)) return;
        const raw = await this._fetch(target);
        if (raw) {
            this._cache.set(target, this.parser.parse(raw));
            console.log(`[SceneManager] Precargado "${target}".`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    async _loadAndRun(target) {
        // 1. Obtener instrucciones (caché o fetch)
        let instructions = this._cache.get(target);

        if (!instructions) {
            const raw = await this._fetch(target);
            if (!raw) return; // error ya logueado en _fetch

            instructions = this.parser.parse(raw);
            this._cache.set(target, instructions);
        }

        // 2. Actualizar state con la escena activa
        this.engine.state.currentFile = `${target}.dan`;

        // 3. Cargar en el engine y arrancar
        await this.engine.loadScript(instructions);
        await this.engine.next(); // ejecutar la primera instrucción automáticamente
    }

    /**
     * Descarga un archivo .dan del servidor.
     * @param   {string}      target
     * @returns {string|null} Contenido del archivo, o null si no se encontró
     */
    async _fetch(target) {
        const url = `${this.basePath}${target}.dan`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                // 404 es un error del escritor (ruta incorrecta), no del engine
                if (response.status === 404) {
                    console.error(`[SceneManager] Script no encontrado: "${url}"`);
                    console.error(`[SceneManager] Verifica que el archivo exista en public/scripts/${target}.dan`);
                } else {
                    console.error(`[SceneManager] Error ${response.status} al cargar "${url}"`);
                }
                return null;
            }

            return await response.text();

        } catch (err) {
            // Error de red (sin conexión, CORS, etc.)
            console.error(`[SceneManager] Error de red al cargar "${url}":`, err.message);
            return null;
        }
    }
}
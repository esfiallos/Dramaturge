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
     * Navega a otra escena con transición de color opcional.
     * Inyectado en engine.sceneLoader = (t, f) => sceneManager.goto(t, f)
     * @param {string}      target    - ej: 'cap01/scene_02'
     * @param {string|null} fadeColor - 'black' | 'white' | null
     */
    async goto(target, fadeColor = null) {
        console.log(`[SceneManager] goto → "${target}"${fadeColor ? ` fade:${fadeColor}` : ''}.`);

        if (fadeColor) {
            // Cargar el script mientras el negro cubre la pantalla,
            // pero no ejecutar todavía — el fade out dispara el primer next().
            await this._fadeTransition(fadeColor, async () => {
                await this.loadOnly(target);
            });
        } else {
            await this._loadAndRun(target);
        }
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

    /**
     * Transición de fundido estructural entre capítulos.
     *
     * Tiempos deliberadamente lentos — esta no es una transición expresiva
     * sino una señal al jugador de que algo importante está cambiando.
     * El escritor no controla la duración: es una decisión del motor.
     *
     * Secuencia:
     *   1. Fade IN  → 800ms  (pantalla se oscurece)
     *   2. Hold     → 300ms  (negro total — aquí se limpia la escena)
     *   3. La escena nueva carga mientras el negro está activo
     *   4. Fade OUT → 800ms  (pantalla aparece con el nuevo estado)
     *
     * El input queda bloqueado durante toda la transición.
     * El skip mode no puede saltarse este momento.
     *
     * @param {'black'|'white'} color
     * @returns {Promise<void>}
     */
    _fadeTransition(color, onReady = null) {
        return new Promise((resolve) => {
            const el = document.getElementById('scene-transition');
            if (!el) { resolve(); return; }

            const FADE_IN_MS  = 800;
            const HOLD_MS     = 300;
            const FADE_OUT_MS = 800;

            // Bloquear input durante toda la transición
            this.engine.isBlocked = true;

            el.style.background    = color === 'white' ? '#ffffff' : '#000000';
            el.style.transition    = `opacity ${FADE_IN_MS}ms ease`;
            el.style.pointerEvents = 'all';
            el.style.opacity       = '0';

            // Forzar reflow para que la transición CSS arranque desde 0
            void el.offsetHeight;

            // ── Fase 1: Fade IN ───────────────────────────────────────────────
            el.style.opacity = '1';

            setTimeout(() => {

                // ── Fase 2: Hold — limpiar escena mientras el negro cubre todo ──
                this.engine.renderer.clearScene?.();
                this.engine.activePawns.clear();
                this.engine.slots = { left: null, center: null, right: null };

                // La escena nueva se carga aquí (el caller hace _loadAndRun tras resolve)
                setTimeout(async () => {
                    // Cargar el script mientras el negro está activo
                    await onReady?.();

                    resolve();

                    // ── Fase 3: Fade OUT — tras cargar la escena nueva ────────
                    el.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
                    void el.offsetHeight;
                    el.style.opacity = '0';

                    setTimeout(() => {
                        el.style.pointerEvents = 'none';
                        // Desbloquear input y arrancar la primera instrucción
                        // automáticamente — el jugador no necesita hacer clic
                        // para salir del negro.
                        this.engine.isBlocked = false;
                        this.engine.next();
                    }, FADE_OUT_MS);

                }, HOLD_MS);

            }, FADE_IN_MS);
        });
    }
}
// src/core/SceneManager.js

/**
 * Gestiona la carga y navegación entre escenas .dan.
 *
 * Responsabilidades:
 * - Descargar archivos .dan desde `/public/scripts/` via fetch
 * - Parsear el contenido y entregarlo al Engine
 * - Mantener una caché en memoria de instrucciones ya parseadas
 * - Ejecutar transiciones de color al navegar entre capítulos
 *
 * Convención de rutas:
 *   `'cap01/scene_02'` → fetch desde `/scripts/cap01/scene_02.dan`
 *
 * Integración con el Engine:
 *   `engine.sceneLoader = (target, fade) => sceneManager.goto(target, fade)`
 *
 * @example
 * const sceneManager = new SceneManager(engine, parser);
 * engine.sceneLoader = (target, fade) => sceneManager.goto(target, fade);
 * await sceneManager.start('cap01/scene_01');
 */
export class SceneManager {

    /** @type {import('./Engine.js').Dramaturge} */
    #engine;

    /** @type {import('./parser/Parser.js').KParser} */
    #parser;

    /** @type {string} */
    #scriptsBasePath;

    /**
     * Caché de instrucciones parseadas por target.
     * Evita re-fetchear y re-parsear escenas ya visitadas.
     * @type {Map<string, object[]>}
     */
    #parsedInstructionsCache = new Map();

    /**
     * @param {import('./Engine.js').Dramaturge}      engine
     * @param {import('./parser/Parser.js').KParser}  parser
     * @param {string} [scriptsBasePath]
     */
    constructor(engine, parser, scriptsBasePath = `${import.meta.env.BASE_URL}scripts/`) {
        this.#engine          = engine;
        this.#parser          = parser;
        this.#scriptsBasePath = scriptsBasePath;
    }

    // ── API pública ────────────────────────────────────────────────────────

    /**
     * Carga la escena inicial y arranca la ejecución.
     * Llamar una sola vez desde `main.js` tras `renderer.init()`.
     * @param {string} startTarget - ej: 'cap01/scene_01'
     */
    async start(startTarget) {
        console.log(`[SceneManager] Iniciando desde "${startTarget}".`);
        await this.#loadAndRun(startTarget);
    }

    /**
     * Navega a otra escena con transición de color opcional.
     * Inyectado en `engine.sceneLoader = (t, f) => sceneManager.goto(t, f)`.
     *
     * @param {string}                   target
     * @param {'black' | 'white' | null} [fadeColor]
     */
    async goto(target, fadeColor = null) {
        console.log(`[SceneManager] goto → "${target}"${fadeColor ? ` fade:${fadeColor}` : ''}.`);

        if (fadeColor) {
            await this.#executeChapterTransition(fadeColor, async () => {
                await this.loadOnly(target);
            });
        } else {
            await this.#loadAndRun(target);
        }
    }

    /**
     * Carga e instala el script en el Engine sin ejecutarlo.
     * Usar para "Continuar partida" — después llamar `engine.next()` manualmente.
     *
     * @param   {string}           target
     * @returns {Promise<boolean>} — true si se cargó correctamente
     */
    async loadOnly(target) {
        const instructions = await this.#fetchAndParseIfNeeded(target);
        if (!instructions) return false;

        this.#engine.state.currentFile = `${target}.dan`;
        await this.#engine.loadScript(instructions);
        return true;
    }

    /**
     * Precarga una escena en caché sin ejecutarla.
     * Útil para anticipar la escena siguiente mientras el jugador lee la actual.
     * @param {string} target
     */
    async prefetch(target) {
        if (this.#parsedInstructionsCache.has(target)) return;
        const instructions = await this.#fetchAndParseIfNeeded(target);
        if (instructions) console.log(`[SceneManager] Precargado "${target}".`);
    }

    // ── Carga y ejecución ──────────────────────────────────────────────────

    /** @param {string} target */
    async #loadAndRun(target) {
        const instructions = await this.#fetchAndParseIfNeeded(target);
        if (!instructions) return;

        this.#engine.state.currentFile = `${target}.dan`;
        await this.#engine.loadScript(instructions);
        await this.#engine.next();
    }

    /**
     * Devuelve instrucciones desde caché o las descarga y parsea.
     * @param   {string} target
     * @returns {Promise<object[]|null>}
     */
    async #fetchAndParseIfNeeded(target) {
        const cachedResult = this.#parsedInstructionsCache.get(target);
        if (cachedResult) return cachedResult;

        const rawScriptContent = await this.#fetchScriptFile(target);
        if (!rawScriptContent) return null;

        const parsedInstructions = this.#parser.parse(rawScriptContent);
        this.#parsedInstructionsCache.set(target, parsedInstructions);
        return parsedInstructions;
    }

    /**
     * Descarga el archivo .dan del servidor.
     * @param   {string}        target
     * @returns {Promise<string|null>}
     */
    async #fetchScriptFile(target) {
        const scriptUrl = `${this.#scriptsBasePath}${target}.dan`;

        try {
            const response = await fetch(scriptUrl);

            if (!response.ok) {
                if (response.status === 404) {
                    console.error(`[SceneManager] Script no encontrado: "${scriptUrl}"`);
                } else {
                    console.error(`[SceneManager] Error ${response.status} al cargar "${scriptUrl}"`);
                }
                return null;
            }

            return await response.text();

        } catch (networkError) {
            console.error(`[SceneManager] Error de red: "${scriptUrl}"`, networkError.message);
            return null;
        }
    }

    // ── Transición de capítulo ─────────────────────────────────────────────

    /**
     * Transición estructural entre capítulos.
     *
     * Tiempos deliberadamente lentos — señal al jugador de que algo importante
     * está cambiando. La duración es decisión del motor, no del escritor.
     *
     * Secuencia:
     *   1. Fade IN  → 800ms (pantalla se oscurece)
     *   2. Hold     → 300ms (negro total — se limpia y carga la escena nueva)
     *   3. Fade OUT → 800ms (pantalla revela el nuevo estado)
     *
     * El input queda bloqueado durante toda la transición.
     *
     * @param {'black' | 'white'}   color
     * @param {() => Promise<void>} onSceneReady — ejecutado mientras la pantalla está opaca
     * @returns {Promise<void>}
     */
    #executeChapterTransition(color, onSceneReady) {
        return new Promise((resolve) => {
            const transitionOverlay = document.getElementById('scene-transition');
            if (!transitionOverlay) { resolve(); return; }

            const FADE_IN_MS  = 800;
            const HOLD_MS     = 300;
            const FADE_OUT_MS = 800;

            this.#engine.isBlocked                = true;
            transitionOverlay.style.background    = color === 'white' ? '#ffffff' : '#000000';
            transitionOverlay.style.transition    = `opacity ${FADE_IN_MS}ms ease`;
            transitionOverlay.style.pointerEvents = 'all';
            transitionOverlay.style.opacity       = '0';

            void transitionOverlay.offsetHeight; // fuerza reflow

            transitionOverlay.style.opacity = '1';

            setTimeout(async () => {
                // Pantalla opaca — limpiar escena anterior y cargar la nueva
                this.#engine.renderer.clearScene?.();

                await onSceneReady();
                resolve();

                setTimeout(() => {
                    transitionOverlay.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
                    void transitionOverlay.offsetHeight;
                    transitionOverlay.style.opacity = '0';

                    setTimeout(() => {
                        transitionOverlay.style.pointerEvents = 'none';
                        this.#engine.isBlocked = false;
                        this.#engine.next();
                    }, FADE_OUT_MS);

                }, HOLD_MS);

            }, FADE_IN_MS);
        });
    }
}
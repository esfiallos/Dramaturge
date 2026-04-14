// src/core/Engine.js
//
// RESPONSABILIDAD:
//   Saber CUÁNDO avanzar y gestionar el flujo de ejecución.
//   El CÓMO ejecutar cada instrucción vive en InstructionExecutor.
//
// ARQUITECTURA:
//   Engine ──── crea ────▶ InstructionExecutor
//         ◀── hooks ──────        │
//                                 │  (handlers de instrucciones)
//
//   Engine expone la API pública (next, reset, loadScript...).
//   InstructionExecutor gestiona personajes, sprites, backlog y diálogos.
//   La comunicación entre ambos es exclusivamente a través de EngineHooks.

import { GameState }            from './State.js';
import { InstructionExecutor }  from './InstructionExecutor.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS     = 2500;
const SKIP_ADVANCE_INTERVAL_MS = 30;
const AUTO_ADVANCE_DEFAULT_MS  = 1800;

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ParsedInstruction
 * @property {string} type
 * @property {number} line
 */

/**
 * @callback PuzzleResolver
 * @param {string} puzzleId
 * @returns {Promise<boolean>}
 */

/**
 * @callback SceneLoader
 * @param {string}      target
 * @param {string|null} fadeColor
 * @returns {Promise<void>}
 */

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Núcleo del motor. Gestiona el flujo de ejecución y el estado de la partida.
 *
 * No sabe cómo ejecutar instrucciones individuales — delega en InstructionExecutor.
 * No sabe cómo renderizar ni reproducir audio — delega en Renderer y AudioManager.
 *
 * Dependencias externas inyectadas tras instanciar:
 * - `puzzleResolver` — abre puzzles y devuelve el resultado
 * - `sceneLoader`    — carga y ejecuta otra escena .dan
 *
 * @example
 * const engine = new Dramaturge(db, renderer, audio, state, saveManager);
 * engine.puzzleResolver = (id) => puzzleSystem.open(id);
 * engine.sceneLoader    = (target, fade) => sceneManager.goto(target, fade);
 * await engine.loadScript(parsedInstructions);
 * await engine.next();
 */
export class Dramaturge {

    // ── Dependencias ───────────────────────────────────────────────────────

    /** @type {import('dexie').Dexie} */
    #db;

    /** @type {import('../modules/Renderer.js').Renderer} */
    renderer;

    /** @type {import('../modules/Audio.js').AudioManager} */
    audio;

    /** @type {GameState} */
    state;

    /** @type {import('./SaveManager.js').SaveManager|null} */
    #saveManager;

    /** @type {InstructionExecutor} */
    #executor;

    // ── Callbacks externos ─────────────────────────────────────────────────

    /** @type {PuzzleResolver|null} */
    puzzleResolver = null;

    /** @type {SceneLoader|null} */
    sceneLoader = null;

    // ── Estado de ejecución ────────────────────────────────────────────────

    /** @type {ParsedInstruction[]} */
    instructions = [];

    /** @type {number} — índice de la próxima instrucción a ejecutar */
    currentIndex = 0;

    /** @type {boolean} — true mientras el engine espera input del jugador */
    isBlocked = false;

    // ── Modos de lectura ───────────────────────────────────────────────────

    /** @type {boolean} */
    autoMode = false;

    /** @type {boolean} */
    skipMode = false;

    /** @type {number} — ms entre avances en modo automático */
    autoAdvanceDelayMs = AUTO_ADVANCE_DEFAULT_MS;

    /**
     * Índice más alto completado por el jugador en esta partida.
     * El modo skip solo avanza hasta este punto — nunca más allá.
     * @type {number}
     */
    highWaterMark = 0;

    // ── Guards y timers ────────────────────────────────────────────────────

    /** @type {boolean} — previene re-entrancia en next() */
    #isAdvancing = false;

    /** @type {ReturnType<typeof setTimeout>|null} */
    #readingModeTimer = null;

    /** @type {ReturnType<typeof setTimeout>|null} */
    #autosaveTimer = null;

    /** @type {Function|null} — callback cuando el skip para automáticamente */
    #onSkipStop = null;

    /**
     * Timestamp de inicio de la sesión actual.
     * Se resetea cada vez que #syncStateSnapshot() acumula el tiempo.
     * @type {number}
     */
    #sessionStartTimestamp = Date.now();

    /**
     * @param {import('dexie').Dexie}                          db
     * @param {import('../modules/Renderer.js').Renderer}      renderer
     * @param {import('../modules/Audio.js').AudioManager}     audio
     * @param {GameState}                                      [state]
     * @param {import('./SaveManager.js').SaveManager|null}    [saveManager]
     */
    constructor(db, renderer, audio, state = null, saveManager = null) {
        this.#db          = db;
        this.renderer     = renderer;
        this.audio        = audio;
        this.state        = state       ?? new GameState();
        this.#saveManager = saveManager ?? null;

        this.#executor = new InstructionExecutor(
            { db, renderer, audio },
            this.#buildEngineHooks(),
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Milisegundos transcurridos desde el inicio de la sesión actual.
     * Usado por MenuSystem para actualizar el HUD de tiempo en vivo.
     * @returns {number}
     */
    get sessionElapsedMs() {
        return Date.now() - this.#sessionStartTimestamp;
    }

    /**
     * Historial de diálogos y narraciones (máx 80 entradas).
     * Expuesto para que MenuSystem lo pase al BacklogPanel.
     * @returns {import('./InstructionExecutor.js').BacklogEntry[]}
     */
    get backlog() {
        return this.#executor.backlog;
    }

    /**
     * Carga instrucciones parseadas y reinicia el cursor de ejecución.
     * @param {ParsedInstruction[]} parsedInstructions
     */
    async loadScript(parsedInstructions) {
        this.instructions = parsedInstructions;
        this.currentIndex = 0;
        console.log('[Engine] Script cargado. Instrucciones:', this.instructions.length);
    }

    /**
     * Avanza el script un paso. Punto de entrada único para el input del jugador.
     *
     * Si el typewriter está activo → lo completa instantáneamente.
     * Si el engine está bloqueado → no hace nada.
     * Guard de re-entrancia → descarta llamadas mientras ya está avanzando.
     */
    async next() {
        if (this.#isAdvancing) return;

        if (this.isBlocked) {
            if (this.renderer.isSkipLocked) {
                this.renderer.flashTextBox?.();
                return;
            }
            this.renderer.flashTextBox?.();
            this.renderer.skipTypewriter?.();
            return;
        }

        this.#isAdvancing = true;
        try {
            await this.#advance();
        } finally {
            this.#isAdvancing = false;
        }
    }

    /**
     * Restaura el engine desde un GameState guardado.
     * @param {GameState} savedState
     */
    async resumeFromState(savedState) {
        this.state         = savedState;
        this.currentIndex  = savedState.currentIndex;
        this.highWaterMark = savedState.highWaterMark ?? 0;

        this.#restoreAudioVolumes(savedState.audioSettings);
        await this.#restoreVisualState(savedState.visualState ?? {});

        console.log(`[Engine] Reanudando desde índice ${this.currentIndex}.`);
    }

    /**
     * Resetea el engine para iniciar una partida nueva.
     * Preserva las preferencias de audio del jugador.
     */
    reset() {
        this.state.reset();
        this.instructions  = [];
        this.currentIndex  = 0;
        this.highWaterMark = 0;
        this.isBlocked     = false;
        this.#isAdvancing  = false;
        this.autoMode      = false;
        this.skipMode      = false;
        this.#onSkipStop   = null;

        clearTimeout(this.#readingModeTimer);
        this.#executor.reset();
        this.renderer.clearScene?.();

        console.log('[Engine] Reset completo. Partida nueva.');
    }

    /**
     * Activa o desactiva el modo automático.
     * Mutuamente excluyente con skipMode.
     * @returns {boolean} — estado resultante del modo auto
     */
    toggleAutoMode() {
        this.autoMode = !this.autoMode;
        this.skipMode = false;
        if (!this.autoMode) clearTimeout(this.#readingModeTimer);
        return this.autoMode;
    }

    /**
     * Inicia el modo skip si hay progreso previo, o lo cancela si ya estaba activo.
     * @param {Function} [onStop] — llamado cuando el skip para
     * @returns {boolean} — true si el skip arrancó
     */
    triggerSkipMode(onStop) {
        if (this.skipMode) {
            this.#cancelSkipMode();
            onStop?.();
            return false;
        }

        if (this.highWaterMark === 0) {
            onStop?.();
            return false;
        }

        this.skipMode    = true;
        this.autoMode    = false;
        this.#onSkipStop = onStop;

        if (!this.isBlocked) this.next();
        return true;
    }

    /**
     * Detiene todos los modos de lectura y fuerza un autosave inmediato.
     * Llamar al abrir el menú de pausa.
     */
    stopAllReadingModes() {
        this.autoMode = false;
        this.skipMode = false;
        clearTimeout(this.#readingModeTimer);
        clearTimeout(this.#autosaveTimer);

        if (this.#saveManager && this.state) {
            this.#saveManager.save(this.state, 'autosave')
                .catch(err => console.error('[Engine] Autosave urgente falló:', err));
        }
    }

    // ── Save / Load ────────────────────────────────────────────────────────

    /** @param {string} [slotId] */
    async saveToSlot(slotId = 'slot_1') {
        if (!this.#saveManager) {
            console.warn('[Engine] saveToSlot: no hay SaveManager.');
            return;
        }
        this.#syncStateSnapshot();
        await this.#saveManager.save(this.state, slotId);
    }

    /** @param {string} [slotId] */
    async loadFromSlot(slotId = 'slot_1') {
        if (!this.#saveManager) return;
        const savedState = await this.#saveManager.load(slotId);
        if (savedState) await this.resumeFromState(savedState);
    }

    exportSaveToFile() {
        if (!this.#saveManager) return;
        this.#syncStateSnapshot();
        this.#saveManager.exportToFile(this.state);
    }

    async importSaveFromFile() {
        if (!this.#saveManager) return;
        const importedState = await this.#saveManager.importFromFile();
        if (importedState) await this.resumeFromState(importedState);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CICLO DE AVANCE INTERNO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Toma la instrucción actual, activa el modo instantáneo si corresponde
     * y la delega al executor.
     *
     * Solo InstructionExecutor llama este método (a través de hooks.advance).
     * Los métodos públicos de Engine usan next().
     */
    async #advance() {
        if (this.currentIndex >= this.instructions.length) {
            console.log('[Engine] Fin del script.');
            return;
        }

        const instruction = this.instructions[this.currentIndex];
        this.currentIndex++;

        this.#activateInstantModeIfSkipping(instruction);

        const result = await this.#executor.dispatch(instruction);

        // El executor señaliza saltos condicionales devolviendo { jump: index }.
        // Engine aplica el salto y continúa el avance.
        if (result?.jump !== undefined) {
            this.currentIndex = result.jump;
            await this.#advance();
        }
    }

    /**
     * Si el skip está activo y la instrucción es texto ya visto,
     * activa el modo instantáneo en el renderer para esta línea.
     * @param {ParsedInstruction} instruction
     */
    #activateInstantModeIfSkipping(instruction) {
        const isTextInstruction = instruction.type === 'DIALOGUE'
                               || instruction.type === 'NARRATE';
        const isAlreadySeen     = (this.currentIndex - 1) <= this.highWaterMark;

        if (this.skipMode && isTextInstruction && isAlreadySeen) {
            this.renderer.activateInstantMode();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCCIÓN DE HOOKS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Crea el objeto de hooks que InstructionExecutor usa para comunicarse
     * con Engine. Bound en el constructor — no recrear por cada instrucción.
     *
     * Diseño intencional: hooks es un objeto plano con funciones, no una
     * referencia al Engine. Queda explícito qué puede hacer el executor
     * con el engine — nada más que lo listado aquí.
     *
     * @returns {import('./InstructionExecutor.js').EngineHooks}
     */
    #buildEngineHooks() {
        return {
            getState:          () => this.state,
            getSkipMode:       () => this.skipMode,
            getPuzzleResolver: () => this.puzzleResolver,
            getSceneLoader:    () => this.sceneLoader,
            advance:           () => this.#advance(),
            setBlocked:        (blocked) => { this.isBlocked = blocked; },
            onTextComplete:    () => this.#onTextLineComplete(),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALLBACKS INTERNOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Llamado por InstructionExecutor cuando el jugador termina de leer
     * una línea de texto. Actualiza highWaterMark, programa autosave
     * y gestiona el avance automático si hay modo activo.
     */
    #onTextLineComplete() {
        const completedIndex = this.currentIndex - 1;
        if (completedIndex > this.highWaterMark) {
            this.highWaterMark = completedIndex;
        }
        this.#syncStateSnapshot();
        this.#scheduleAutosave();
        this.#scheduleNextAdvanceIfReadingMode();
    }

    // ── Modo skip ──────────────────────────────────────────────────────────

    #cancelSkipMode() {
        this.skipMode = false;
        clearTimeout(this.#readingModeTimer);
        this.#onSkipStop?.();
        this.#onSkipStop = null;
    }

    // ── Autosave y scheduling ──────────────────────────────────────────────

    #syncStateSnapshot() {
        this.state.currentIndex  = this.currentIndex;
        this.state.highWaterMark = this.highWaterMark;
        this.state.playTime     += Math.floor(this.sessionElapsedMs / 1000);
        this.#sessionStartTimestamp = Date.now();
    }

    #scheduleAutosave() {
        if (!this.#saveManager) return;
        clearTimeout(this.#autosaveTimer);
        this.#autosaveTimer = setTimeout(() => {
            this.#saveManager.save(this.state, 'autosave')
                .catch(err => console.error('[Engine] Autosave falló:', err));
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    #scheduleNextAdvanceIfReadingMode() {
        if (this.autoMode) {
            clearTimeout(this.#readingModeTimer);
            this.#readingModeTimer = setTimeout(() => {
                if (this.autoMode && !this.isBlocked) this.next();
            }, this.autoAdvanceDelayMs);

        } else if (this.skipMode) {
            const stillHasSeenContent = this.currentIndex <= this.highWaterMark;
            if (stillHasSeenContent) {
                clearTimeout(this.#readingModeTimer);
                this.#readingModeTimer = setTimeout(() => {
                    if (!this.skipMode || this.#isAdvancing) return;
                    this.#isAdvancing = true;
                    this.#advance().finally(() => { this.#isAdvancing = false; });
                }, SKIP_ADVANCE_INTERVAL_MS);
            } else {
                this.#cancelSkipMode();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESTAURACIÓN DE ESTADO AL CARGAR
    // ─────────────────────────────────────────────────────────────────────────

    /** @param {{ bgmVolume: number, sfxVolume: number, voiceVolume: number }} settings */
    #restoreAudioVolumes(settings) {
        this.audio.setVolume('bgm',   settings.bgmVolume);
        this.audio.setVolume('se',    settings.sfxVolume);
        this.audio.setVolume('voice', settings.voiceVolume);
    }

    /** @param {object} visualState */
    async #restoreVisualState(visualState) {
        if (visualState.bg) {
            await this.renderer.changeBackground(visualState.bg, 'none');
        }

        if (visualState.sprites) {
            await this.#executor.restoreSprites(visualState.sprites);
        }

        if (visualState.bgm?.track) {
            await this.audio.playBGM(visualState.bgm.track, visualState.bgm.vol ?? 0.5);
        }

        if (visualState.mode === 'narrate') {
            this.renderer.applyNarrationMode?.(true);
        } else if (visualState.mode === 'dialogue') {
            this.renderer.applyNarrationMode?.(false);
        }
    }
}
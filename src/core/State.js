// src/core/State.js

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AudioSettings
 * @property {number} bgmVolume   - 0.0 a 1.0
 * @property {number} sfxVolume   - 0.0 a 1.0
 * @property {number} voiceVolume - 0.0 a 1.0
 */

/**
 * @typedef {Object} ActiveBgmState
 * @property {string} track - Nombre del archivo sin extensión
 * @property {number} vol   - Volumen al momento de guardar (0.0 a 1.0)
 */

/**
 * @typedef {Object} SpriteSlotState
 * @property {string} actorId - ID del personaje ocupando el slot
 * @property {string} path    - Ruta completa del sprite activo
 */

/**
 * @typedef {Object} VisualState
 * @property {string|null}                       bg      - Nombre del fondo activo o null
 * @property {Record<string, SpriteSlotState>}   sprites - Estado de cada slot de sprite
 * @property {'dialogue' | 'narrate' | null}     mode    - Modo de textbox activo
 * @property {ActiveBgmState|null}               bgm     - BGM activo o null
 */

/**
 * @typedef {Object} GameStateSnapshot
 * @property {string}                    currentFile
 * @property {number}                    currentIndex
 * @property {number}                    highWaterMark
 * @property {Record<string, *>}         flags
 * @property {string[]}                  inventory
 * @property {AudioSettings}             audioSettings
 * @property {VisualState}               visualState
 * @property {number|null}               savedAt
 * @property {number}                    playTime
 */

// ─── GameState ────────────────────────────────────────────────────────────────

/**
 * Estado serializable completo de una partida.
 *
 * Es el único objeto que viaja entre el Engine y el SaveManager.
 * Todos sus campos deben ser primitivos, arrays u objetos planos —
 * sin instancias de clases, Promises ni referencias al DOM.
 *
 * El Engine lo mantiene sincronizado; SaveManager lo persiste en Dexie.
 *
 * @example
 * const state = new GameState();
 * state.setFlag('cap01_completo', 'true');
 * state.addItem('llave_maestra');
 * const snapshot = state.toJSON(); // listo para Dexie
 */
export class GameState {

    // ── Progreso narrativo ─────────────────────────────────────────────────

    /** @type {string} — archivo .dan activo, necesario para reanudar la partida */
    currentFile;

    /** @type {number} — índice de la próxima instrucción a ejecutar */
    currentIndex;

    /**
     * Índice más alto completado por el jugador en esta partida.
     * El modo skip solo avanza hasta este punto — nunca más allá.
     * @type {number}
     */
    highWaterMark;

    // ── Historia y objetos ─────────────────────────────────────────────────

    /**
     * Flags de historia activados con `set flag.key = value`.
     * @type {Record<string, boolean|number|string>}
     */
    flags;

    /**
     * Inventario del jugador. Array sin duplicados.
     * Modificado con `set inventory.add` y `set inventory.remove`.
     * @type {string[]}
     */
    inventory;

    // ── Preferencias persistentes ──────────────────────────────────────────

    /** @type {AudioSettings} */
    audioSettings;

    // ── Estado visual y de audio para restaurar al cargar ─────────────────

    /** @type {VisualState} */
    visualState;

    // ── Metadata del save ──────────────────────────────────────────────────

    /** @type {number|null} — timestamp del último guardado */
    savedAt;

    /** @type {number} — segundos acumulados de juego */
    playTime;

    /** @param {Partial<GameStateSnapshot>} [snapshot] */
    constructor(snapshot = {}) {
        this.currentFile   = snapshot.currentFile   ?? 'inicio.dan';
        this.currentIndex  = snapshot.currentIndex  ?? 0;
        this.highWaterMark = snapshot.highWaterMark ?? 0;
        this.flags         = snapshot.flags         ?? {};
        this.inventory     = snapshot.inventory     ?? [];
        this.savedAt       = snapshot.savedAt       ?? null;
        this.playTime      = snapshot.playTime      ?? 0;

        this.audioSettings = {
            bgmVolume:   snapshot.audioSettings?.bgmVolume   ?? 0.5,
            sfxVolume:   snapshot.audioSettings?.sfxVolume   ?? 0.8,
            voiceVolume: snapshot.audioSettings?.voiceVolume ?? 1.0,
        };

        this.visualState = {
            bg:      snapshot.visualState?.bg      ?? null,
            sprites: snapshot.visualState?.sprites ?? {},
            mode:    snapshot.visualState?.mode    ?? null,
            bgm:     snapshot.visualState?.bgm     ?? null,
        };
    }

    // ── Inventario ─────────────────────────────────────────────────────────

    /**
     * Añade un ítem al inventario si no existe ya.
     * @param {string} itemKey
     */
    addItem(itemKey) {
        if (!this.inventory.includes(itemKey)) {
            this.inventory.push(itemKey);
        }
    }

    /**
     * Elimina un ítem del inventario.
     * @param {string} itemKey
     */
    removeItem(itemKey) {
        this.inventory = this.inventory.filter(key => key !== itemKey);
    }

    /**
     * @param {string} itemKey
     * @returns {boolean}
     */
    hasItem(itemKey) {
        return this.inventory.includes(itemKey);
    }

    // ── Flags ──────────────────────────────────────────────────────────────

    /**
     * Establece un flag parseando el valor a su tipo nativo.
     * `'true'`/`'false'` → boolean, numéricos → number, resto → string.
     *
     * @param {string} key
     * @param {string} rawValue — valor como string desde el Parser
     */
    setFlag(key, rawValue) {
        if (rawValue === 'true')       this.flags[key] = true;
        else if (rawValue === 'false') this.flags[key] = false;
        else if (!isNaN(rawValue))     this.flags[key] = Number(rawValue);
        else                           this.flags[key] = rawValue;
    }

    /**
     * @param {string} key
     * @param {*}      [fallback=null]
     * @returns {boolean|number|string|null}
     */
    getFlag(key, fallback = null) {
        return this.flags[key] ?? fallback;
    }

    // ── Serialización ──────────────────────────────────────────────────────

    /**
     * Devuelve un snapshot plano listo para Dexie o exportar a JSON.
     * @returns {GameStateSnapshot}
     */
    toJSON() {
        return {
            currentFile:   this.currentFile,
            currentIndex:  this.currentIndex,
            highWaterMark: this.highWaterMark,
            flags:         { ...this.flags },
            inventory:     [...this.inventory],
            audioSettings: { ...this.audioSettings },
            visualState: {
                bg:      this.visualState.bg,
                sprites: { ...this.visualState.sprites },
                mode:    this.visualState.mode,
                bgm:     this.visualState.bgm ? { ...this.visualState.bgm } : null,
            },
            savedAt:  this.savedAt,
            playTime: this.playTime,
        };
    }

    /**
     * Resetea todos los campos narrativos para una partida nueva.
     * Preserva `audioSettings` — son preferencias del jugador, no del juego.
     */
    reset() {
        const preservedAudioSettings = { ...this.audioSettings };

        this.currentFile   = 'inicio.dan';
        this.currentIndex  = 0;
        this.highWaterMark = 0;
        this.flags         = {};
        this.inventory     = [];
        this.visualState   = { bg: null, sprites: {}, mode: null, bgm: null };
        this.savedAt       = null;
        this.playTime      = 0;
        this.audioSettings = preservedAudioSettings;
    }

    /**
     * Crea una instancia desde un snapshot plano (Dexie o JSON importado).
     * @param {GameStateSnapshot} snapshot
     * @returns {GameState}
     */
    static fromJSON(snapshot) {
        return new GameState(snapshot);
    }
}
// src/core/State.js
//
// GameState es el ÚNICO objeto que se serializa para save/load.
// El Engine lo mantiene sincronizado; SaveManager lo persiste.
//
//   Todos los campos de esta clase deben ser primitivos, arrays, u objetos planos.
//   No guardar instancias de clases, Promises, ni referencias al DOM.

export class GameState {
    constructor(data = {}) {
        // ── Progreso narrativo ────────────────────────────────────────────
        // Nombre del archivo .dan activo (para cargar el script correcto al reanudar)
        this.currentFile  = data.currentFile  ?? 'inicio.dan';

        // Índice de la próxima instrucción a ejecutar.
        // Se sincroniza con engine.currentIndex antes de cada save.
        this.currentIndex = data.currentIndex ?? 0;

        // ── Flags de historia ─────────────────────────────────────────────
        // Activados con: set flag.key = value
        // Ejemplo: { 'puzzle_P01_solved': true, 'conociste_a_miki': true }
        this.flags        = data.flags        ?? {};

        // ── Inventario ────────────────────────────────────────────────────
        // Array de strings (item keys). Sin duplicados.
        // Modificado con: set inventory.add key  /  set inventory.remove key
        this.inventory    = data.inventory    ?? [];

        // ── Configuración de audio ────────────────────────────────────────
        // Persiste entre sesiones. Modificado desde el panel de ajustes.
        this.audioSettings = {
            bgmVolume:   data.audioSettings?.bgmVolume   ?? 0.5,
            sfxVolume:   data.audioSettings?.sfxVolume   ?? 0.8,
            voiceVolume: data.audioSettings?.voiceVolume ?? 1.0,
        };

        // ── Estado visual activo ─────────────────────────────────────────────
        // Guardado automáticamente por el Engine en cada BG_CHANGE / SPRITE_SHOW/HIDE.
        // Permite restaurar la pantalla al cargar sin tener que re-ejecutar el script.
        //
        //   bg:      ruta del fondo activo  (string | null)
        //   sprites: { slot → { actorId, path } }  — slots 'left','center','right'
        //   mode:    'dialogue' | 'narrate' | null  — modo de textbox activo
        this.visualState = data.visualState ?? { bg: null, sprites: {}, mode: null };

        // ── Progreso de lectura — para el modo skip ─────────────────────
        // Índice más alto completado por el jugador.
        // Skip solo avanza automáticamente hasta este punto — nunca más allá.
        this.highWaterMark = data.highWaterMark ?? 0;

        // ── Metadata del save ─────────────────────────────────────────────────
        this.savedAt  = data.savedAt  ?? null; // timestamp del último guardado
        this.playTime = data.playTime ?? 0;    // segundos acumulados de juego
    }

    // ─── Operaciones de inventario ────────────────────────────────────────────

    addItem(itemKey) {
        if (!this.inventory.includes(itemKey)) {
            this.inventory.push(itemKey);
        }
    }

    removeItem(itemKey) {
        this.inventory = this.inventory.filter(k => k !== itemKey);
    }

    hasItem(itemKey) {
        return this.inventory.includes(itemKey);
    }

    // ─── Operaciones de flags ─────────────────────────────────────────────────

    setFlag(key, value) {
        // Parsear el valor si viene como string desde el Parser
        if (value === 'true')  this.flags[key] = true;
        else if (value === 'false') this.flags[key] = false;
        else if (!isNaN(value))     this.flags[key] = Number(value);
        else                        this.flags[key] = value; // string literal
    }

    getFlag(key, defaultValue = null) {
        return this.flags[key] ?? defaultValue;
    }

    // ─── Serialización ────────────────────────────────────────────────────────

    /** Devuelve un objeto plano listo para guardar en Dexie o exportar a JSON. */
    toJSON() {
        return {
            currentFile:   this.currentFile,
            currentIndex:  this.currentIndex,
            flags:         { ...this.flags },
            inventory:     [...this.inventory],
            audioSettings: { ...this.audioSettings },
            highWaterMark: this.highWaterMark,
            visualState:   {
                bg:      this.visualState.bg,
                sprites: { ...this.visualState.sprites },
                mode:    this.visualState.mode,
            },
            savedAt:  this.savedAt,
            playTime: this.playTime,
        };
    }

    /**
     * Resetea el estado a una partida nueva, conservando las preferencias de audio.
     * Llamado por Engine.reset() al iniciar Nueva Partida.
     */
    reset() {
        const audio = { ...this.audioSettings }; // conservar preferencias
        // Re-inicializar todos los campos narrativos
        this.currentFile   = 'inicio.dan';
        this.currentIndex  = 0;
        this.flags         = {};
        this.inventory     = [];
        this.visualState   = { bg: null, sprites: {}, mode: null };
        this.highWaterMark = 0;
        this.savedAt       = null;
        this.playTime      = 0;
        this.audioSettings = audio; // restaurar preferencias
    }

    /** Crea una instancia de GameState desde un objeto plano (Dexie o JSON importado). */
    static fromJSON(data) {
        return new GameState(data);
    }
}
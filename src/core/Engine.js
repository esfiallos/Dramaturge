// src/core/Engine.js

import { Character } from './models/Character.js';

// Ruta base del deployment — '/' en dev, '/Dramaturge/' en GitHub Pages
const BASE_URL = import.meta.env.BASE_URL;

import { GameState } from './State.js';

export class Dramaturge {
    /**
     * @param {object}      db           - Instancia de Dexie
     * @param {Renderer}  renderer     - Módulo de render
     * @param {AudioManager}     audioManager - Módulo de audio
     * @param {GameState}   state        - Estado del juego (crea uno nuevo si no se pasa)
     * @param {SaveManager} saveManager  - Gestor de guardado (autosave desactivado si null)
     */
    constructor(db, renderer, audioManager, state = null, saveManager = null) {
        this.db          = db;
        this.renderer    = renderer;
        this.audio       = audioManager;
        this.state       = state       ?? new GameState();
        this.saveManager = saveManager ?? null;

        this.activePawns = new Map();
        this.slots       = { left: null, center: null, right: null };

        this.instructions = [];
        this.currentIndex = 0;
        this.isBlocked    = false;
        this._lastTextMode = null; // 'narrate' | 'dialogue' | null — para detectar cambios de modo

        // ── Modos de lectura ──────────────────────────────────────────────
        // Auto: avanza solo cuando el typewriter termina (con delay)
        // Skip: avanza instantáneamente, solo en líneas ya vistas
        this.autoMode      = false;
        this.skipMode      = false;
        this.autoDelay     = 1800;  // ms entre líneas en modo auto (configurable)
        this._autoTimer    = null;
        // highWaterMark: índice más alto que el jugador ha completado.
        // Suficiente para skip en historias lineales con finales por flags/inventario.
        // No necesita ser un Set — ahorra memoria y escrituras en DB.
        this.highWaterMark  = 0;
        this._nextRunning   = false; // guard de re-entrancia para next()

        // ── Backlog ───────────────────────────────────────────────────────
        // Array de { speaker: string|null, text: string } — últimas 80 entradas.
        // speaker es null para narraciones.
        this.backlog = [];

        // Callbacks externos — se inyectan después de instanciar el Engine.
        //
        // Firma: (puzzleId: string) => Promise<boolean>
        // Inyectar: engine.puzzleResolver = (id) => puzzleSystem.open(id)
        this.puzzleResolver = null;

        // Firma: (target: string) => Promise<void>
        // Inyectar: engine.sceneLoader = (t) => sceneManager.goto(t)
        this.sceneLoader = null;

        this._sessionStart = Date.now();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resetea el engine completamente para una partida nueva.
     * Limpia: state narrativo, pawns, backlog, renderer visual, timers.
     * Conserva: preferencias de audio (viven en state.audioSettings).
     */
    reset() {
        // Estado narrativo
        this.state.reset();
        this.highWaterMark  = 0;
        this.currentIndex   = 0;
        this.instructions   = [];
        this._lastTextMode  = null;
        this._nextRunning   = false;

        // Modos de lectura
        this.autoMode = false;
        this.skipMode = false;
        clearTimeout(this._autoTimer);
        this.renderer._instantText = false;
        this._skipOnStop = null;

        // Personajes instanciados
        this.activePawns.clear();

        // Backlog de la sesión
        this.backlog = [];

        // Renderer: limpiar escena visual
        this.renderer.clearScene?.();

        console.log('[Engine] Reset completo. Partida nueva.');
    }

    async loadScript(parsedInstructions) {
        this.instructions = parsedInstructions;
        this.currentIndex = 0;
        console.log('[Engine] Script cargado. Instrucciones:', this.instructions.length);
    }

    async resumeFromState(loadedState) {
        this.state        = loadedState;
        this.currentIndex = loadedState.currentIndex;
        // Restaurar hasta dónde llegó el jugador (para skip)
        this.highWaterMark = loadedState.highWaterMark ?? 0;

        // ── Restaurar audio ───────────────────────────────────────────────
        const { bgmVolume, sfxVolume, voiceVolume } = loadedState.audioSettings;
        this.audio.setVolume('bgm',   bgmVolume);
        this.audio.setVolume('se',    sfxVolume);
        this.audio.setVolume('voice', voiceVolume);

        // ── Restaurar estado visual (fondo + sprites) ─────────────────────
        // Orden garantizado: fondo → sprites → modo de textbox
        const vs = loadedState.visualState ?? {};

        // 1. Fondo
        if (vs.bg) {
            await this.renderer.changeBackground(vs.bg, 'none');
        }

        // 2. Sprites (cargar pawn si no está activo y renderizar en su slot)
        if (vs.sprites) {
            for (const [slot, { actorId, path }] of Object.entries(vs.sprites)) {
                if (!this.activePawns.has(actorId)) {
                    const data = await this.db.characters.get(actorId);
                    if (data) {
                        const { Character } = await import('./models/Character.js');
                        this.activePawns.set(actorId, new Character(data));
                    }
                }
                this.slots[slot] = actorId;
                await this.renderer.renderSprite(actorId, path, slot, 'none');
            }
        }

        // 3. Modo de textbox
        if (vs.mode === 'narrate') {
            this.renderer._setNarrationMode?.(true);
            this._lastTextMode = 'narrate';
        } else if (vs.mode === 'dialogue') {
            this.renderer._setNarrationMode?.(false);
            this._lastTextMode = 'dialogue';
        }

        console.log(`[Engine] Reanudando desde índice ${this.currentIndex}. Visual restaurado.`);
    }

    // next() público — punto de entrada para input del usuario.
    // Guard de re-entrancia: si ya está corriendo, el clic extra se descarta.
    // Las llamadas internas del engine usan _nextInternal() directamente.
    async next() {
        if (this._nextRunning) return;

        // Si hay texto activo: skip o flash de feedback
        if (this.isBlocked) {
            if (this.renderer._skipLocked) {
                this.renderer.flashTextBox?.();
                return;
            }
            this.renderer.flashTextBox?.();
            this.renderer.skipTypewriter?.();
            return;
        }

        this._nextRunning = true;
        try {
            await this._nextInternal();
        } finally {
            this._nextRunning = false;
        }
    }

    // _nextInternal() — avance real del script.
    // Se llama recursivamente desde execute() para instrucciones no-bloqueantes.
    async _nextInternal() {

        if (this.currentIndex >= this.instructions.length) {
            console.log('[Engine] Fin del script.');
            return;
        }

        const inst = this.instructions[this.currentIndex];
        this.currentIndex++;

        // Skip mode: si esta instrucción ya fue vista, el typewriter será instantáneo
        // (renderer._instantText = true). _syncStateAndSave lo relanzará automáticamente.
        if (this.skipMode && (this.currentIndex - 1) <= this.highWaterMark) {
            const isText = inst.type === 'DIALOGUE' || inst.type === 'NARRATE';
            if (isText) this.renderer._instantText = true;
        }

        await this.execute(inst);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DESPACHADOR CENTRAL
    // ─────────────────────────────────────────────────────────────────────────


    // ─────────────────────────────────────────────────────────────────────────
    // DESPACHADOR CENTRAL
    // ─────────────────────────────────────────────────────────────────────────

    async execute(inst) {
        switch (inst.type) {

            // ── Personajes ────────────────────────────────────────────────────

            case 'PAWN_LOAD': {
                for (const id of inst.names) {
                    if (this.activePawns.has(id)) continue;
                    const data = await this.db.characters.get(id);
                    if (data) {
                        this.activePawns.set(id, new Character(data));
                        console.log(`[Engine] Pawn "${id}" instanciado.`);
                    } else {
                        console.error(`[Engine] ERROR: personaje "${id}" no existe en la DB.`);
                    }
                }
                await this._nextInternal();
                break;
            }

            case 'SPRITE_SHOW': {
                const pawn = this.activePawns.get(inst.actor);
                if (!pawn) {
                    console.error(`[Engine] SPRITE_SHOW: pawn "${inst.actor}" no cargado.`);
                    break;
                }
                const path = `${BASE_URL}${pawn.getSprite(inst.pose).replace(/^\//, '')}`;
                this._clearActorFromSlots(inst.actor);
                this.slots[inst.slot] = inst.actor;
                await this.renderer.renderSprite(inst.actor, path, inst.slot, inst.effect);
                // Persistir sprite activo para restaurar al cargar
                this.state.visualState.sprites[inst.slot] = { actorId: inst.actor, path };
                await this._nextInternal();
                break;
            }

            case 'SPRITE_HIDE': {
                const slot = this._getActorSlot(inst.actor);
                if (slot) {
                    await this.renderer.hideSprite(inst.actor, slot, inst.effect);
                    this.slots[slot] = null;
                    delete this.state.visualState.sprites[slot]; // ← limpiar del state
                }
                await this._nextInternal();
                break;
            }

            // ── Escena y audio ─────────────────────────────────────────────────

            case 'BG_CHANGE': {
                await this.renderer.changeBackground(inst.target, inst.effect, inst.time);
                this.state.visualState.bg = inst.target; // ← persistir fondo activo
                await this._nextInternal();
                break;
            }

            case 'AUDIO': {
                if (inst.audioType === 'bgm') {
                    this.audio.playBGM(inst.param, parseFloat(inst.vol ?? 0.5));
                } else if (inst.audioType === 'se') {
                    this.audio.playSE(inst.param, parseFloat(inst.vol ?? 0.8));
                }
                await this._nextInternal();
                break;
            }

            // ── Diálogo y narración ────────────────────────────────────────────

            case 'DIALOGUE': {
                const pawn = this.activePawns.get(inst.actor);

                // Transición de modo si veníamos de narración
                // modeTransition bloquea con overlay blanco mientras el modo cambia
                if (this._lastTextMode === 'narrate') {
                    await this.renderer.modeTransition(false);
                }
                this._lastTextMode = 'dialogue';
                this.state.visualState.mode = 'dialogue';

                if (inst.pose && pawn) {
                    const posePath  = `${BASE_URL}${pawn.getSprite(inst.pose).replace(/^\//, '')}`;
                    const actorSlot = this._getActorSlot(inst.actor);
                    if (actorSlot) this.renderer.updateSprite(inst.actor, posePath, actorSlot);
                }

                if (inst.vo && pawn) {
                    this.audio.playVoice(`${pawn.voicePrefix}${inst.vo}.mp3`);
                }

                this.isBlocked    = true;
                const speakerName = pawn ? pawn.name : inst.actor;

                // Añadir al backlog (máx 80 entradas — FIFO)
                this.backlog.push({ speaker: speakerName, text: inst.text });
                if (this.backlog.length > 80) this.backlog.shift();

                await this.renderer.typewriter(speakerName, inst.text, () => {
                    this.isBlocked = false;
                    this._syncStateAndSave();
                });
                break;
            }

            case 'NARRATE': {
                // Transición de modo si veníamos de diálogo normal
                if (this._lastTextMode === 'dialogue') {
                    await this.renderer.modeTransition(true);
                }
                this.state.visualState.mode = 'narrate';

                this.isBlocked = true;

                // Añadir al backlog
                this.backlog.push({ speaker: null, text: inst.text });
                if (this.backlog.length > 80) this.backlog.shift();

                await this.renderer.typewriter(null, inst.text, () => {
                    this.isBlocked = false;
                    this._syncStateAndSave();
                });
                break;
            }

            // ── Control de flujo ───────────────────────────────────────────────

            case 'WAIT': {
                // En skip mode no esperamos — el jugador ya vio esta escena
                if (!this.skipMode) {
                    const ms = this._parseDuration(inst.duration);
                    this.isBlocked = true;
                    await new Promise(resolve => setTimeout(resolve, ms));
                    this.isBlocked = false;
                }
                await this._nextInternal();
                break;
            }

            case 'PUZZLE': {
                this.isBlocked = true;

                let passed = false;
                if (this.puzzleResolver) {
                    passed = await this.puzzleResolver(inst.puzzleId);
                } else {
                    console.warn(`[Engine] Puzzle "${inst.puzzleId}": no hay puzzleResolver. Asumiendo fallo.`);
                }

                // Actualizar contadores en el state
                this.state.setFlag(`${inst.puzzleId}_result`, String(passed));
                const solved = this.state.getFlag('puzzles_solved', 0) ?? 0;
                const failed = this.state.getFlag('puzzles_failed', 0) ?? 0;
                if (passed) {
                    this.state.setFlag('puzzles_solved', String(Number(solved) + 1));
                } else {
                    this.state.setFlag('puzzles_failed', String(Number(failed) + 1));
                }

                console.log(`[Engine] Puzzle "${inst.puzzleId}" → ${passed ? 'PASS' : 'FAIL'}`);

                // Mostrar resultado como narración — desbloquea al hacer clic
                const resultText = passed ? inst.passText : inst.failText;
                // El resultado del puzzle usa modo narrador
                this.state.visualState.mode = 'narrate';

                await this.renderer.typewriter(null, resultText, () => {
                    this.isBlocked = false;
                    this._syncStateAndSave();
                });
                break;
            }

            case 'GOTO': {
                this._syncState();

                if (!this.sceneLoader) {
                    this.state.currentFile = `${inst.target}.dan`;
                    console.log(`[Engine] GOTO → "${inst.target}.dan". Sin SceneManager: detenido.`);
                    break;
                }

                // fadeColor viene del parser: 'black' | 'white' | undefined
                // SceneManager gestiona la transición visual antes de cargar la escena.
                await this.sceneLoader(inst.target, inst.fadeColor ?? null);
                break;
            }

            // ── Efectos de pantalla ───────────────────────────────────────────────

            case 'FX_SHAKE': {
                // Bloquea hasta que termina la animación de shake.
                const ms = this._parseDuration(inst.duration);
                await this.renderer.fxShake(ms);
                await this._nextInternal();
                break;
            }

            case 'FX_FLASH': {
                // Bloquea hasta que el flash desaparece completamente.
                const ms = this._parseDuration(inst.duration);
                await this.renderer.fxFlash(inst.color, ms);
                await this._nextInternal();
                break;
            }

            case 'FX_VIGNETTE': {
                // Instantáneo — no bloquea.
                this.renderer.fxVignette(inst.state === 'on');
                await this._nextInternal();
                break;
            }

            // ── Estado ─────────────────────────────────────────────────────────

            case 'SET_FLAG': {
                this.state.setFlag(inst.key, inst.value);
                console.log(`[Engine] Flag "${inst.key}" = ${inst.value}`);
                await this._nextInternal();
                break;
            }

            case 'INVENTORY_ADD': {
                this.state.addItem(inst.item);
                console.log(`[Engine] Inventario: añadido "${inst.item}".`);
                await this._nextInternal();
                break;
            }

            case 'INVENTORY_REMOVE': {
                this.state.removeItem(inst.item);
                console.log(`[Engine] Inventario: eliminado "${inst.item}".`);
                await this._nextInternal();
                break;
            }

            case 'UNLOCK': {
                // Meta-progreso — no vive en GameState sino en db.gallery directamente.
                // Sobrevive a Nueva Partida y a borrar saves.
                const existing = await this.db.gallery?.get(inst.cgId);
                if (!existing) {
                    const path = `${BASE_URL}assets/cg/${inst.cgId}`;
                    await this.db.gallery?.put({
                        id:          inst.cgId,
                        title:       inst.title ?? inst.cgId,
                        path,
                        unlockedAt:  Date.now(),
                    });
                    console.log(`[Engine] CG desbloqueado: "${inst.cgId}"`);
                }
                await this._nextInternal();
                break;
            }

            // ── Condicionales ──────────────────────────────────────────────────────

            case 'COND_JUMP': {
                // Evaluar la condición — si es FALSA, saltar a targetIndex
                const passes = this._evalCondition(inst.condition);
                if (!passes) {
                    this.currentIndex = inst.targetIndex;
                }
                await this._nextInternal();
                break;
            }

            case 'JUMP': {
                // Salto incondicional (generado por el bloque else)
                this.currentIndex = inst.targetIndex;
                await this._nextInternal();
                break;
            }

            default: {
                console.warn(`[Engine] Instrucción no reconocida: "${inst.type}". Saltando.`);
                await this._nextInternal();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MODOS DE LECTURA
    // ─────────────────────────────────────────────────────────────────────────

    toggleAuto() {
        this.autoMode = !this.autoMode;
        this.skipMode = false; // mutuamente excluyentes
        if (!this.autoMode) clearTimeout(this._autoTimer);
        console.log(`[Engine] Auto: ${this.autoMode ? 'ON' : 'OFF'}`);
        return this.autoMode;
    }

    /**
     * Inicia el skip: avanza instantáneamente hasta el primer texto no visto.
     * Se detiene solo cuando currentIndex > highWaterMark o llega al fin.
     * Si skip ya está activo, lo cancela (permite abortar con un segundo toque).
     *
     * @param {Function} [onStop] - Callback cuando el skip para (botón → off)
     */
    triggerSkip(onStop) {
        if (this.skipMode) {
            // Segundo toque — cancelar skip en curso
            this.skipMode = false;
            clearTimeout(this._autoTimer);
            this.renderer._instantText = false;
            onStop?.();
            return false;
        }

        if (this.highWaterMark === 0) {
            // Sin historial — no hay nada que skipear
            onStop?.();
            return false;
        }

        this.skipMode  = true;
        this.autoMode  = false;
        this._skipOnStop = onStop; // guardado para cuando el skip para solo

        if (!this.isBlocked) this.next();
        return true;
    }

    /** Llamado internamente cuando el skip llega al final de lo ya visto */
    _stopSkip() {
        if (!this.skipMode) return;
        this.skipMode = false;
        this.renderer._instantText = false;
        clearTimeout(this._autoTimer);
        this._skipOnStop?.();
        this._skipOnStop = null;
    }

    stopModes() {
        this.autoMode = false;
        this.skipMode = false;
        clearTimeout(this._autoTimer);
        // Forzar flush del autosave pendiente al detener modos
        clearTimeout(this._autosaveTimer);
        if (this.saveManager && this.state) {
            this.saveManager.save(this.state, 'autosave')
                .catch(err => console.error('[Engine] Autosave flush falló:', err));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVE / LOAD
    // ─────────────────────────────────────────────────────────────────────────

    async saveToSlot(slotId = 'slot_1') {
        if (!this.saveManager) { console.warn('[Engine] No hay SaveManager.'); return; }
        this._syncState();
        await this.saveManager.save(this.state, slotId);
    }

    async loadFromSlot(slotId = 'slot_1') {
        if (!this.saveManager) return;
        const loaded = await this.saveManager.load(slotId);
        if (loaded) await this.resumeFromState(loaded);
    }

    exportSave() {
        if (!this.saveManager) return;
        this._syncState();
        this.saveManager.exportToFile(this.state);
    }

    async importSave() {
        if (!this.saveManager) return;
        const loaded = await this.saveManager.importFromFile();
        if (loaded) await this.resumeFromState(loaded);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // EVALUADOR DE CONDICIONES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Evalúa una condición compilada por el Parser.
     * @param   {object} cond - instrucción IF_FLAG o IF_INVENTORY original
     * @returns {boolean}
     */
    _evalCondition(cond) {
        if (cond.type === 'IF_INVENTORY') {
            return this.state.hasItem(cond.item);
        }

        if (cond.type === 'IF_FLAG') {
            const raw     = this.state.getFlag(cond.key, null);
            const current = this._coerce(raw);
            const target  = this._coerce(cond.value);
            const op      = cond.op;

            switch (op) {
                case '==': return current == target;
                case '!=': return current != target;
                case '>':  return Number(current) >  Number(target);
                case '<':  return Number(current) <  Number(target);
                case '>=': return Number(current) >= Number(target);
                case '<=': return Number(current) <= Number(target);
                default:
                    console.warn(`[Engine] Operador desconocido: "${op}"`);
                    return false;
            }
        }

        console.warn(`[Engine] Tipo de condición desconocido: "${cond.type}"`);
        return false;
    }

    /**
     * Convierte strings a sus tipos nativos para comparación.
     * 'true'/'false' → boolean, números → number, resto → string.
     */
    _coerce(val) {
        if (val === 'true')  return true;
        if (val === 'false') return false;
        const n = Number(val);
        return isNaN(n) ? val : n;
    }

    _syncState() {
        this.state.currentIndex = this.currentIndex;
        this.state.playTime    += Math.floor((Date.now() - this._sessionStart) / 1000);
        this._sessionStart      = Date.now();
        this.state.highWaterMark = this.highWaterMark;
    }

    _syncStateAndSave() {
        // Avanzar el marcador de progreso
        if (this.currentIndex - 1 > this.highWaterMark)
            this.highWaterMark = this.currentIndex - 1;
        this._syncState();

        // Autosave con debounce — cancela la escritura anterior si llega otra
        // antes de 2.5s. Evita microfreezes en hardware lento por writes continuos.
        if (this.saveManager) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = setTimeout(() => {
                this.saveManager.save(this.state, 'autosave')
                    .catch(err => console.error('[Engine] Autosave falló:', err));
            }, 2500);
        }

        // Auto-avance si está activo
        if (this.autoMode) {
            clearTimeout(this._autoTimer);
            this._autoTimer = setTimeout(() => {
                if (this.autoMode && !this.isBlocked) this.next();
            }, this.autoDelay);

        // Skip mode: continuar si aún hay contenido ya visto por delante
        } else if (this.skipMode) {
            if (this.currentIndex <= this.highWaterMark) {
                clearTimeout(this._autoTimer);
                this._autoTimer = setTimeout(() => {
                    if (!this.skipMode || this._nextRunning) return;
                    // Llamar _nextInternal directamente — sabemos que isBlocked = false
                    // y evitamos que los guards de next() descarten el avance.
                    this._nextRunning = true;
                    this._nextInternal().finally(() => { this._nextRunning = false; });
                }, 30);
            } else {
                // Llegamos al límite del contenido visto — parar automáticamente
                this._stopSkip();
            }
        }
    }

    /** '2s' → 2000 | '500ms' → 500 | '1.5s' → 1500 */
    _parseDuration(str) {
        if (str.endsWith('ms')) return parseInt(str);
        return Math.round(parseFloat(str) * 1000);
    }

    _getActorSlot(actorId) {
        return Object.keys(this.slots).find(k => this.slots[k] === actorId) ?? null;
    }

    _clearActorFromSlots(actorId) {
        const old = this._getActorSlot(actorId);
        if (old) this.slots[old] = null;
    }
}
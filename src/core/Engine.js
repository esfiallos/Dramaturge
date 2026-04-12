// src/core/Engine.js

import { Character }  from './models/Character.js';
import { GameState }  from './State.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEPLOYMENT_BASE_URL      = import.meta.env.BASE_URL;
const BACKLOG_MAX_ENTRIES      = 80;
const AUTOSAVE_DEBOUNCE_MS     = 2500;
const SKIP_ADVANCE_INTERVAL_MS = 30;
const AUTO_ADVANCE_DEFAULT_MS  = 1800;

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'left' | 'center' | 'right'} SpriteSlot
 */

/**
 * @typedef {Object} BacklogEntry
 * @property {string|null} speaker - Nombre del personaje o null si es narración
 * @property {string}      text
 */

/**
 * @typedef {Object} ParsedInstruction
 * @property {string} type - Tipo de instrucción: 'DIALOGUE', 'NARRATE', 'GOTO', etc.
 * @property {number} line - Línea original en el script .dan
 */

/**
 * @typedef {Object} VisualSlotState
 * @property {string} actorId
 * @property {string} path
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
 * Núcleo del motor de novela visual.
 *
 * Responsabilidades:
 * - Ejecutar instrucciones parseadas del lenguaje Koedan en secuencia
 * - Mantener el estado del juego sincronizado con el progreso narrativo
 * - Gestionar los modos de lectura: normal, automático y skip
 * - Coordinar renderer, audio y sistema de guardado
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

    /** @type {'dialogue' | 'narrate' | null} — modo de textbox activo */
    #lastRenderedTextMode = null;

    // ── Personajes en escena ───────────────────────────────────────────────

    /** @type {Map<string, Character>} — actores cargados en memoria por id */
    #loadedCharacters = new Map();

    /** @type {Record<SpriteSlot, string|null>} — actorId ocupando cada slot */
    #occupiedSlots = { left: null, center: null, right: null };

    // ── Backlog ────────────────────────────────────────────────────────────

    /** @type {BacklogEntry[]} — historial de diálogos y narraciones, máx 80 */
    backlog = [];

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

    /** @type {number} — timestamp de inicio de sesión para calcular playTime */
    #sessionStartTimestamp = Date.now();

    /**
     * @param {import('dexie').Dexie}                          db
     * @param {import('../modules/Renderer.js').Renderer}      renderer
     * @param {import('../modules/Audio.js').AudioManager}     audio
     * @param {GameState}                                      state
     * @param {import('./SaveManager.js').SaveManager|null}    saveManager
     */
    constructor(db, renderer, audio, state = null, saveManager = null) {
        this.#db          = db;
        this.renderer     = renderer;
        this.audio        = audio;
        this.state        = state       ?? new GameState();
        this.#saveManager = saveManager ?? null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Carga un array de instrucciones parseadas y reinicia el cursor de ejecución.
     * @param {ParsedInstruction[]} parsedInstructions
     */
    async loadScript(parsedInstructions) {
        this.instructions = parsedInstructions;
        this.currentIndex = 0;
        console.log('[Engine] Script cargado. Instrucciones:', this.instructions.length);
    }

    /**
     * Avanza el script un paso. Punto de entrada para todo input del jugador.
     *
     * Si el typewriter está activo: lo completa instantáneamente.
     * Si el engine está bloqueado esperando input: no hace nada.
     * Guard de re-entrancia: descarta llamadas mientras ya está avanzando.
     */
    async next() {
        if (this.#isAdvancing) return;

        if (this.isBlocked) {
            if (this.renderer._skipLocked) {
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
     * Reconstruye el estado visual (fondo, sprites, modo) y de audio.
     * @param {GameState} savedState
     */
    async resumeFromState(savedState) {
        this.state         = savedState;
        this.currentIndex  = savedState.currentIndex;
        this.highWaterMark = savedState.highWaterMark ?? 0;

        this.#restoreAudioVolumes(savedState.audioSettings);
        await this.#restoreVisualState(savedState.visualState ?? {});

        console.log(`[Engine] Reanudando desde índice ${this.currentIndex}. Visual restaurado.`);
    }

    /**
     * Resetea el engine completamente para iniciar una partida nueva.
     * Preserva las preferencias de audio del jugador.
     */
    reset() {
        this.state.reset();
        this.instructions          = [];
        this.currentIndex          = 0;
        this.highWaterMark         = 0;
        this.isBlocked             = false;
        this.#lastRenderedTextMode = null;
        this.#isAdvancing          = false;
        this.autoMode              = false;
        this.skipMode              = false;
        this.#onSkipStop           = null;
        this.backlog               = [];

        clearTimeout(this.#readingModeTimer);
        this.renderer._instantText = false;
        this.#loadedCharacters.clear();
        this.#occupiedSlots = { left: null, center: null, right: null };
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
     * El skip avanza instantáneamente hasta el primer contenido no visto.
     *
     * @param {Function} [onStop] — llamado cuando el skip para (por límite o cancelación)
     * @returns {boolean} — true si el skip arrancó, false si se canceló o no hay historial
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
     * Detiene todos los modos de lectura activos y fuerza un autosave inmediato.
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

    /** @param {string} slotId */
    async saveToSlot(slotId = 'slot_1') {
        if (!this.#saveManager) {
            console.warn('[Engine] saveToSlot: no hay SaveManager.');
            return;
        }
        this.#syncStateSnapshot();
        await this.#saveManager.save(this.state, slotId);
    }

    /** @param {string} slotId */
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
    // DESPACHADOR DE INSTRUCCIONES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ejecuta una instrucción Koedan y avanza automáticamente si no bloquea.
     * Cada case es responsable de llamar `#advance()` o bloquear el engine.
     * @param {ParsedInstruction} instruction
     */
    async #dispatch(instruction) {
        switch (instruction.type) {

            // ── Personajes ─────────────────────────────────────────────────

            case 'PAWN_LOAD': {
                await this.#loadCharactersIntoMemory(instruction.names);
                await this.#advance();
                break;
            }

            case 'SPRITE_SHOW': {
                await this.#showCharacterSprite(instruction);
                await this.#advance();
                break;
            }

            case 'SPRITE_HIDE': {
                await this.#hideCharacterSprite(instruction);
                await this.#advance();
                break;
            }

            // ── Escena y audio ─────────────────────────────────────────────

            case 'BG_CHANGE': {
                await this.renderer.changeBackground(instruction.target, instruction.effect, instruction.time);
                this.state.visualState.bg = instruction.target;
                await this.#advance();
                break;
            }

            case 'AUDIO': {
                await this.#handleAudioInstruction(instruction);
                await this.#advance();
                break;
            }

            // ── Diálogo y narración ────────────────────────────────────────

            case 'DIALOGUE': {
                await this.#renderDialogueLine(instruction);
                break;
            }

            case 'NARRATE': {
                await this.#renderNarrationLine(instruction);
                break;
            }

            // ── Control de flujo ───────────────────────────────────────────

            case 'WAIT': {
                await this.#waitIfNotSkipping(instruction.duration);
                await this.#advance();
                break;
            }

            case 'PUZZLE': {
                await this.#openAndResolvePuzzle(instruction);
                break;
            }

            case 'GOTO': {
                await this.#navigateToScene(instruction);
                break;
            }

            // ── Efectos de pantalla ────────────────────────────────────────

            case 'FX_SHAKE': {
                await this.renderer.fxShake(this.#parseDurationToMs(instruction.duration));
                await this.#advance();
                break;
            }

            case 'FX_FLASH': {
                await this.renderer.fxFlash(instruction.color, this.#parseDurationToMs(instruction.duration));
                await this.#advance();
                break;
            }

            case 'FX_VIGNETTE': {
                this.renderer.fxVignette(instruction.state === 'on');
                await this.#advance();
                break;
            }

            // ── Estado del juego ───────────────────────────────────────────

            case 'SET_FLAG': {
                this.state.setFlag(instruction.key, instruction.value);
                await this.#advance();
                break;
            }

            case 'INVENTORY_ADD': {
                this.state.addItem(instruction.item);
                await this.#advance();
                break;
            }

            case 'INVENTORY_REMOVE': {
                this.state.removeItem(instruction.item);
                await this.#advance();
                break;
            }

            case 'UNLOCK': {
                await this.#unlockGalleryCg(instruction);
                await this.#advance();
                break;
            }

            // ── Condicionales ──────────────────────────────────────────────

            case 'COND_JUMP': {
                const conditionPasses = this.#evaluateCondition(instruction.condition);
                if (!conditionPasses) this.currentIndex = instruction.targetIndex;
                await this.#advance();
                break;
            }

            case 'JUMP': {
                this.currentIndex = instruction.targetIndex;
                await this.#advance();
                break;
            }

            default: {
                console.warn(`[Engine] Instrucción desconocida: "${instruction.type}". Saltando.`);
                await this.#advance();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AVANCE INTERNO
    // ─────────────────────────────────────────────────────────────────────────

    async #advance() {
        if (this.currentIndex >= this.instructions.length) {
            console.log('[Engine] Fin del script.');
            return;
        }

        const currentInstruction = this.instructions[this.currentIndex];
        this.currentIndex++;

        this.#activateInstantTextIfSkipping(currentInstruction);
        await this.#dispatch(currentInstruction);
    }

    /** @param {ParsedInstruction} instruction */
    #activateInstantTextIfSkipping(instruction) {
        const isTextInstruction = instruction.type === 'DIALOGUE' || instruction.type === 'NARRATE';
        const isAlreadySeen     = (this.currentIndex - 1) <= this.highWaterMark;

        if (this.skipMode && isTextInstruction && isAlreadySeen) {
            this.renderer._instantText = true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HANDLERS DE INSTRUCCIONES
    // ─────────────────────────────────────────────────────────────────────────

    /** @param {string[]} characterIds */
    async #loadCharactersIntoMemory(characterIds) {
        for (const characterId of characterIds) {
            if (this.#loadedCharacters.has(characterId)) continue;
            const characterData = await this.#db.characters.get(characterId);
            if (characterData) {
                this.#loadedCharacters.set(characterId, new Character(characterData));
                console.log(`[Engine] Personaje "${characterId}" cargado.`);
            } else {
                console.error(`[Engine] Personaje "${characterId}" no encontrado en DB.`);
            }
        }
    }

    /** @param {ParsedInstruction} instruction */
    async #showCharacterSprite(instruction) {
        const character = this.#loadedCharacters.get(instruction.actor);
        if (!character) {
            console.error(`[Engine] SPRITE_SHOW: "${instruction.actor}" no está cargado.`);
            return;
        }
        const spritePath = this.#buildAssetUrl(character.getSprite(instruction.pose));
        this.#removeCharacterFromOccupiedSlots(instruction.actor);
        this.#occupiedSlots[instruction.slot] = instruction.actor;
        await this.renderer.renderSprite(instruction.actor, spritePath, instruction.slot, instruction.effect);
        this.state.visualState.sprites[instruction.slot] = { actorId: instruction.actor, path: spritePath };
    }

    /** @param {ParsedInstruction} instruction */
    async #hideCharacterSprite(instruction) {
        const occupiedSlot = this.#findSlotOccupiedByCharacter(instruction.actor);
        if (!occupiedSlot) return;
        await this.renderer.hideSprite(instruction.actor, occupiedSlot, instruction.effect);
        this.#occupiedSlots[occupiedSlot] = null;
        delete this.state.visualState.sprites[occupiedSlot];
    }

    /** @param {ParsedInstruction} instruction */
    async #handleAudioInstruction(instruction) {
        if (instruction.audioType === 'bgm') {
            const bgmVolume = parseFloat(instruction.vol ?? 0.5);
            this.audio.playBGM(instruction.param, bgmVolume);
            this.state.visualState.bgm = { track: instruction.param, vol: bgmVolume };
        } else if (instruction.audioType === 'se') {
            this.audio.playSE(instruction.param, parseFloat(instruction.vol ?? 0.8));
        }
    }

    /** @param {ParsedInstruction} instruction */
    async #renderDialogueLine(instruction) {
        const character = this.#loadedCharacters.get(instruction.actor);

        if (this.#lastRenderedTextMode === 'narrate') {
            await this.renderer.modeTransition(false);
        }
        this.#lastRenderedTextMode  = 'dialogue';
        this.state.visualState.mode = 'dialogue';

        if (instruction.pose && character) {
            const posePath   = this.#buildAssetUrl(character.getSprite(instruction.pose));
            const activeSlot = this.#findSlotOccupiedByCharacter(instruction.actor);
            if (activeSlot) this.renderer.updateSprite(instruction.actor, posePath, activeSlot);
        }

        if (instruction.vo && character) {
            this.audio.playVoice(`${character.voicePrefix}${instruction.vo}.mp3`);
        }

        const speakerName = character ? character.name : instruction.actor;
        this.#pushToBacklog({ speaker: speakerName, text: instruction.text });

        this.isBlocked = true;
        await this.renderer.typewriter(speakerName, instruction.text, () => {
            this.isBlocked = false;
            this.#syncStateAndScheduleAutosave();
        });
    }

    /** @param {ParsedInstruction} instruction */
    async #renderNarrationLine(instruction) {
        if (this.#lastRenderedTextMode === 'dialogue') {
            await this.renderer.modeTransition(true);
        }
        this.state.visualState.mode = 'narrate';
        this.#pushToBacklog({ speaker: null, text: instruction.text });

        this.isBlocked = true;
        await this.renderer.typewriter(null, instruction.text, () => {
            this.isBlocked = false;
            this.#syncStateAndScheduleAutosave();
        });
    }

    /** @param {string} duration */
    async #waitIfNotSkipping(duration) {
        if (this.skipMode) return;
        const waitMs = this.#parseDurationToMs(duration);
        this.isBlocked = true;
        await new Promise(resolve => setTimeout(resolve, waitMs));
        this.isBlocked = false;
    }

    /** @param {ParsedInstruction} instruction */
    async #openAndResolvePuzzle(instruction) {
        this.isBlocked = true;

        let puzzlePassed = false;
        if (this.puzzleResolver) {
            puzzlePassed = await this.puzzleResolver(instruction.puzzleId);
        } else {
            console.warn(`[Engine] Puzzle "${instruction.puzzleId}": puzzleResolver no inyectado.`);
        }

        this.state.setFlag(`${instruction.puzzleId}_result`, String(puzzlePassed));
        this.#incrementPuzzleCounter(puzzlePassed);
        console.log(`[Engine] Puzzle "${instruction.puzzleId}" → ${puzzlePassed ? 'PASS' : 'FAIL'}`);

        const resultNarration       = puzzlePassed ? instruction.passText : instruction.failText;
        this.state.visualState.mode = 'narrate';

        await this.renderer.typewriter(null, resultNarration, () => {
            this.isBlocked = false;
            this.#syncStateAndScheduleAutosave();
        });
    }

    /** @param {ParsedInstruction} instruction */
    async #navigateToScene(instruction) {
        this.#syncStateSnapshot();
        if (!this.sceneLoader) {
            this.state.currentFile = `${instruction.target}.dan`;
            console.log(`[Engine] GOTO "${instruction.target}": sceneLoader no inyectado.`);
            return;
        }
        await this.sceneLoader(instruction.target, instruction.fadeColor ?? null);
    }

    /** @param {ParsedInstruction} instruction */
    async #unlockGalleryCg(instruction) {
        const alreadyUnlocked = await this.#db.gallery?.get(instruction.cgId);
        if (alreadyUnlocked) return;
        const cgPath = `${DEPLOYMENT_BASE_URL}assets/cg/${instruction.cgId}`;
        await this.#db.gallery?.put({
            id:         instruction.cgId,
            title:      instruction.title ?? instruction.cgId,
            path:       cgPath,
            unlockedAt: Date.now(),
        });
        console.log(`[Engine] CG desbloqueado: "${instruction.cgId}"`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MODO SKIP
    // ─────────────────────────────────────────────────────────────────────────

    #cancelSkipMode() {
        this.skipMode              = false;
        this.renderer._instantText = false;
        clearTimeout(this.#readingModeTimer);
        this.#onSkipStop?.();
        this.#onSkipStop = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SINCRONIZACIÓN DE ESTADO Y AUTOSAVE
    // ─────────────────────────────────────────────────────────────────────────

    #syncStateAndScheduleAutosave() {
        const completedIndex = this.currentIndex - 1;
        if (completedIndex > this.highWaterMark) {
            this.highWaterMark = completedIndex;
        }
        this.#syncStateSnapshot();
        this.#scheduleAutosave();
        this.#scheduleNextAdvanceIfReadingMode();
    }

    #syncStateSnapshot() {
        this.state.currentIndex  = this.currentIndex;
        this.state.highWaterMark = this.highWaterMark;
        this.state.playTime     += Math.floor((Date.now() - this.#sessionStartTimestamp) / 1000);
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

    /** @param {{ bgmVolume: number, sfxVolume: number, voiceVolume: number }} audioSettings */
    #restoreAudioVolumes(audioSettings) {
        this.audio.setVolume('bgm',   audioSettings.bgmVolume);
        this.audio.setVolume('se',    audioSettings.sfxVolume);
        this.audio.setVolume('voice', audioSettings.voiceVolume);
    }

    /** @param {object} visualState */
    async #restoreVisualState(visualState) {
        if (visualState.bg) {
            await this.renderer.changeBackground(visualState.bg, 'none');
        }
        if (visualState.sprites) {
            await this.#restoreActiveSprites(visualState.sprites);
        }
        if (visualState.bgm?.track) {
            await this.audio.playBGM(visualState.bgm.track, visualState.bgm.vol ?? 0.5);
        }
        if (visualState.mode === 'narrate') {
            this.renderer._setNarrationMode?.(true);
            this.#lastRenderedTextMode = 'narrate';
        } else if (visualState.mode === 'dialogue') {
            this.renderer._setNarrationMode?.(false);
            this.#lastRenderedTextMode = 'dialogue';
        }
    }

    /** @param {Record<SpriteSlot, VisualSlotState>} savedSprites */
    async #restoreActiveSprites(savedSprites) {
        for (const [slot, { actorId, path }] of Object.entries(savedSprites)) {
            if (!this.#loadedCharacters.has(actorId)) {
                const characterData = await this.#db.characters.get(actorId);
                if (characterData) {
                    this.#loadedCharacters.set(actorId, new Character(characterData));
                }
            }
            this.#occupiedSlots[slot] = actorId;
            await this.renderer.renderSprite(actorId, path, slot, 'none');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVALUADOR DE CONDICIONES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {ParsedInstruction} condition
     * @returns {boolean}
     */
    #evaluateCondition(condition) {
        if (condition.type === 'IF_INVENTORY') {
            return this.state.hasItem(condition.item);
        }

        if (condition.type === 'IF_FLAG') {
            const storedValue   = this.#coerceToNativeType(this.state.getFlag(condition.key, null));
            const expectedValue = this.#coerceToNativeType(condition.value);

            switch (condition.op) {
                case '==': return storedValue == expectedValue;
                case '!=': return storedValue != expectedValue;
                case '>':  return Number(storedValue) >  Number(expectedValue);
                case '<':  return Number(storedValue) <  Number(expectedValue);
                case '>=': return Number(storedValue) >= Number(expectedValue);
                case '<=': return Number(storedValue) <= Number(expectedValue);
                default:
                    console.warn(`[Engine] Operador desconocido: "${condition.op}"`);
                    return false;
            }
        }

        console.warn(`[Engine] Tipo de condición desconocido: "${condition.type}"`);
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILIDADES PRIVADAS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Convierte un string a su tipo nativo para comparaciones de condiciones.
     * @param {*} rawValue
     * @returns {boolean|number|string}
     */
    #coerceToNativeType(rawValue) {
        if (rawValue === 'true')  return true;
        if (rawValue === 'false') return false;
        const asNumber = Number(rawValue);
        return isNaN(asNumber) ? rawValue : asNumber;
    }

    /**
     * @param {string} durationString — '2s', '500ms', '1.5s'
     * @returns {number}
     */
    #parseDurationToMs(durationString) {
        if (durationString.endsWith('ms')) return parseInt(durationString);
        return Math.round(parseFloat(durationString) * 1000);
    }

    /**
     * @param {string} relativePath
     * @returns {string}
     */
    #buildAssetUrl(relativePath) {
        return `${DEPLOYMENT_BASE_URL}${relativePath.replace(/^\//, '')}`;
    }

    /** @param {BacklogEntry} entry */
    #pushToBacklog(entry) {
        this.backlog.push(entry);
        if (this.backlog.length > BACKLOG_MAX_ENTRIES) this.backlog.shift();
    }

    /** @param {boolean} puzzlePassed */
    #incrementPuzzleCounter(puzzlePassed) {
        const counterKey   = puzzlePassed ? 'puzzles_solved' : 'puzzles_failed';
        const currentCount = this.state.getFlag(counterKey, 0) ?? 0;
        this.state.setFlag(counterKey, String(Number(currentCount) + 1));
    }

    /**
     * @param {string} actorId
     * @returns {SpriteSlot|null}
     */
    #findSlotOccupiedByCharacter(actorId) {
        return Object.keys(this.#occupiedSlots)
            .find(slot => this.#occupiedSlots[slot] === actorId) ?? null;
    }

    /** @param {string} actorId */
    #removeCharacterFromOccupiedSlots(actorId) {
        const previousSlot = this.#findSlotOccupiedByCharacter(actorId);
        if (previousSlot) this.#occupiedSlots[previousSlot] = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMPATIBILIDAD — proxies para nombres heredados
    // Módulos externos aún referencian estos nombres.
    // Eliminar cuando MenuSystem y canvas.js se actualicen.
    // ─────────────────────────────────────────────────────────────────────────

    /** @deprecated usar toggleAutoMode() */
    toggleAuto()        { return this.toggleAutoMode(); }

    /** @deprecated usar triggerSkipMode() */
    triggerSkip(onStop) { return this.triggerSkipMode(onStop); }

    /** @deprecated usar stopAllReadingModes() */
    stopModes()         { return this.stopAllReadingModes(); }
}
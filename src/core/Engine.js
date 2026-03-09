// src/core/Engine.js

import { Character } from './models/Character.js';
import { GameState } from './State.js';

export class Dramaturge {
    /**
     * @param {object}      db           - Instancia de Dexie
     * @param {MERenderer}  renderer     - Módulo de render
     * @param {MEAudio}     audioManager - Módulo de audio
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

    async loadScript(parsedInstructions) {
        this.instructions = parsedInstructions;
        this.currentIndex = 0;
        console.log('[Engine] Script cargado. Instrucciones:', this.instructions.length);
    }

    async resumeFromState(loadedState) {
        this.state        = loadedState;
        this.currentIndex = loadedState.currentIndex;
        const { bgmVolume, sfxVolume, voiceVolume } = loadedState.audioSettings;
        this.audio.setVolume('bgm',   bgmVolume);
        this.audio.setVolume('se',    sfxVolume);
        this.audio.setVolume('voice', voiceVolume);
        console.log(`[Engine] Reanudando desde índice ${this.currentIndex}.`);
    }

    async next() {
        // No procesar mientras el overlay de transición de modo está activo
        if (this.renderer.isTransitioning) return;

        if (this.isBlocked) {
            // Si el skip acaba de completar el texto, dar feedback visual
            // pero respetar el lock de 180ms para que el usuario lo lea
            if (this.renderer._skipLocked) {
                this.renderer.flashTextBox?.();
                return;
            }
            this.renderer.flashTextBox?.();
            this.renderer.skipTypewriter?.();
            return;
        }

        if (this.currentIndex >= this.instructions.length) {
            console.log('[Engine] Fin del script.');
            return;
        }

        const inst = this.instructions[this.currentIndex];
        this.currentIndex++;
        await this.execute(inst);
    }

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
                await this.next();
                break;
            }

            case 'SPRITE_SHOW': {
                const pawn = this.activePawns.get(inst.actor);
                if (!pawn) {
                    console.error(`[Engine] SPRITE_SHOW: pawn "${inst.actor}" no cargado.`);
                    break;
                }
                const path = pawn.getSprite(inst.pose);
                this._clearActorFromSlots(inst.actor);
                this.slots[inst.slot] = inst.actor;
                await this.renderer.renderSprite(inst.actor, path, inst.slot, inst.effect);
                await this.next();
                break;
            }

            case 'SPRITE_HIDE': {
                const slot = this._getActorSlot(inst.actor);
                if (slot) {
                    await this.renderer.hideSprite(inst.actor, slot, inst.effect);
                    this.slots[slot] = null;
                }
                await this.next();
                break;
            }

            // ── Escena y audio ─────────────────────────────────────────────────

            case 'BG_CHANGE': {
                await this.renderer.changeBackground(inst.target, inst.effect, inst.time);
                await this.next();
                break;
            }

            case 'AUDIO': {
                if (inst.audioType === 'bgm') {
                    this.audio.playBGM(inst.param, parseFloat(inst.vol ?? 0.5));
                } else if (inst.audioType === 'se') {
                    this.audio.playSE(inst.param, parseFloat(inst.vol ?? 0.8));
                }
                await this.next();
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

                if (inst.pose && pawn) {
                    const posePath  = pawn.getSprite(inst.pose);
                    const actorSlot = this._getActorSlot(inst.actor);
                    if (actorSlot) this.renderer.updateSprite(inst.actor, posePath, actorSlot);
                }

                if (inst.vo && pawn) {
                    this.audio.playVoice(`${pawn.voicePrefix}${inst.vo}.mp3`);
                }

                this.isBlocked    = true;
                const speakerName = pawn ? pawn.name : inst.actor;

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
                this._lastTextMode = 'narrate';

                this.isBlocked = true;

                await this.renderer.typewriter(null, inst.text, () => {
                    this.isBlocked = false;
                    this._syncStateAndSave();
                });
                break;
            }

            // ── Control de flujo ───────────────────────────────────────────────

            case 'WAIT': {
                const ms = this._parseDuration(inst.duration);
                this.isBlocked = true;
                await new Promise(resolve => setTimeout(resolve, ms));
                this.isBlocked = false;
                await this.next();
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
                this._lastTextMode = 'narrate';

                await this.renderer.typewriter(null, resultText, () => {
                    this.isBlocked = false;
                    this._syncStateAndSave();
                });
                break;
            }

            case 'GOTO': {
                this._syncState();

                if (!this.sceneLoader) {
                    this.state.currentFile = `${inst.target}.ems`;
                    console.log(`[Engine] GOTO → "${inst.target}.dan". Sin SceneManager: detenido.`);
                    break;
                }

                if (inst.transition && this.renderer?.sceneTransition) {
                    // Fase 1: fade IN (oscurece la pantalla, ~480ms)
                    // Cargamos la escena mientras la pantalla está oscura/blanca
                    // para que el jugador nunca vea el swap de assets.
                    const halfMs = 480;
                    this.renderer.sceneTransition(inst.transition, halfMs); // no await — corre en paralelo
                    await new Promise(r => setTimeout(r, halfMs));          // esperar que tape la pantalla
                    await this.sceneLoader(inst.target);                    // cargar nueva escena
                    // Fase 2: el fade OUT lo completa sceneTransition internamente
                } else {
                    await this.sceneLoader(inst.target);
                }
                break;
            }

            // ── Estado ─────────────────────────────────────────────────────────

            case 'SET_FLAG': {
                this.state.setFlag(inst.key, inst.value);
                console.log(`[Engine] Flag "${inst.key}" = ${inst.value}`);
                await this.next();
                break;
            }

            case 'INVENTORY_ADD': {
                this.state.addItem(inst.item);
                console.log(`[Engine] Inventario: añadido "${inst.item}".`);
                await this.next();
                break;
            }

            case 'INVENTORY_REMOVE': {
                this.state.removeItem(inst.item);
                console.log(`[Engine] Inventario: eliminado "${inst.item}".`);
                await this.next();
                break;
            }

            // ── Condicionales ──────────────────────────────────────────────────────

            case 'COND_JUMP': {
                // Evaluar la condición — si es FALSA, saltar a targetIndex
                const passes = this._evalCondition(inst.condition);
                if (!passes) {
                    this.currentIndex = inst.targetIndex;
                }
                await this.next();
                break;
            }

            case 'JUMP': {
                // Salto incondicional (generado por el bloque else)
                this.currentIndex = inst.targetIndex;
                await this.next();
                break;
            }

            default: {
                console.warn(`[Engine] Instrucción no reconocida: "${inst.type}". Saltando.`);
                await this.next();
            }
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
    }

    _syncStateAndSave() {
        this._syncState();
        if (this.saveManager) {
            this.saveManager.save(this.state, 'autosave')
                .catch(err => console.error('[Engine] Autosave falló:', err));
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
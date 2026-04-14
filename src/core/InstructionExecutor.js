// src/core/InstructionExecutor.js
//
// Ejecuta instrucciones individuales del lenguaje Koedan.
//
// RESPONSABILIDAD:
//   Saber CÓMO ejecutar cada tipo de instrucción.
//   No sabe CUÁNDO ejecutar ni gestiona el flujo de avance — eso es Engine.
//
// RELACIÓN CON ENGINE:
//   Engine crea un InstructionExecutor en su constructor y le pasa un
//   objeto de hooks (EngineHooks) con las funciones que el ejecutor necesita
//   llamar de vuelta en el engine (bloquear, avanzar, notificar fin de texto).
//
// PARA AÑADIR UNA INSTRUCCIÓN NUEVA:
//   1. Grammar.js  — regex con named groups
//   2. Parser.js   — entrada en PARSE_RULES
//   3. Aquí        — case en dispatch() + método privado #handleNueva()

import { Character } from './models/Character.js';

// ─── Utilidades de módulo ─────────────────────────────────────────────────────

const DEPLOYMENT_BASE_URL  = import.meta.env.BASE_URL;
const BACKLOG_MAX_ENTRIES  = 80;

/**
 * @param {string} relativePath
 * @returns {string}
 */
function buildAssetUrl(relativePath) {
    return `${DEPLOYMENT_BASE_URL}${relativePath.replace(/^\//, '')}`;
}

/**
 * @param {string} durationString — '2s', '500ms', '1.5s'
 * @returns {number} — milisegundos
 */
function parseDurationToMs(durationString) {
    if (durationString.endsWith('ms')) return parseInt(durationString);
    return Math.round(parseFloat(durationString) * 1000);
}

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'left' | 'center' | 'right'} SpriteSlot
 */

/**
 * @typedef {Object} BacklogEntry
 * @property {string|null} speaker
 * @property {string}      text
 */

/**
 * Conjunto de funciones que InstructionExecutor necesita llamar en Engine.
 * Engine las construye y las pasa al crear el executor.
 *
 * Usando un objeto de hooks en lugar de una referencia directa al Engine
 * se evita el acoplamiento circular y queda explícito qué puede hacer
 * el executor con el engine — nada más.
 *
 * @typedef {Object} EngineHooks
 * @property {() => import('./State.js').GameState}  getState         - Estado actual
 * @property {() => boolean}                         getSkipMode      - Si skip está activo
 * @property {() => Function|null}                   getPuzzleResolver
 * @property {() => Function|null}                   getSceneLoader
 * @property {() => Promise<void>}                   advance          - Avanza al siguiente paso
 * @property {(blocked: boolean) => void}            setBlocked       - Bloquea o desbloquea
 * @property {() => void}                            onTextComplete   - Fin de typewriter
 */

// ─── InstructionExecutor ──────────────────────────────────────────────────────

/**
 * Ejecuta instrucciones individuales del lenguaje Koedan.
 *
 * Gestiona el estado visual de la escena: qué personajes están cargados,
 * qué slot ocupa cada uno, y el historial de diálogos (backlog).
 *
 * @example
 * const executor = new InstructionExecutor({ db, renderer, audio }, engineHooks);
 * await executor.dispatch(instruction);
 */
export class InstructionExecutor {

    // ── Dependencias externas ──────────────────────────────────────────────

    /** @type {import('dexie').Dexie} */
    #db;

    /** @type {import('../modules/Renderer.js').Renderer} */
    #renderer;

    /** @type {import('../modules/Audio.js').AudioManager} */
    #audio;

    /** @type {EngineHooks} */
    #hooks;

    // ── Estado de escena ───────────────────────────────────────────────────

    /** @type {Map<string, Character>} — actores cargados en memoria */
    #loadedCharacters = new Map();

    /**
     * ActorId que ocupa cada slot de sprite en pantalla.
     * @type {Record<SpriteSlot, string|null>}
     */
    #occupiedSlots = { left: null, center: null, right: null };

    // ── Historial de diálogos ──────────────────────────────────────────────

    /** @type {BacklogEntry[]} */
    #backlog = [];

    // ── Tracking de modo de texto ──────────────────────────────────────────

    /** @type {'dialogue' | 'narrate' | null} */
    #lastRenderedTextMode = null;

    /**
     * @param {{ db: import('dexie').Dexie, renderer: object, audio: object }} deps
     * @param {EngineHooks} hooks
     */
    constructor({ db, renderer, audio }, hooks) {
        this.#db       = db;
        this.#renderer = renderer;
        this.#audio    = audio;
        this.#hooks    = hooks;
    }

    // ── API pública ────────────────────────────────────────────────────────

    /**
     * El historial de diálogos. Engine lo expone hacia el exterior (MenuSystem).
     * @returns {BacklogEntry[]}
     */
    get backlog() { return this.#backlog; }

    /**
     * Personajes cargados en memoria.
     * Engine lo necesita en resumeFromState para restaurar sprites.
     * @returns {Map<string, Character>}
     */
    get loadedCharacters() { return this.#loadedCharacters; }

    /**
     * Slots ocupados por actores.
     * Engine lo necesita en resumeFromState para restaurar sprites.
     * @returns {Record<SpriteSlot, string|null>}
     */
    get occupiedSlots() { return this.#occupiedSlots; }

    /**
     * Limpia el estado de escena para una partida nueva.
     * Llamar desde Engine.reset().
     */
    reset() {
        this.#loadedCharacters.clear();
        this.#occupiedSlots        = { left: null, center: null, right: null };
        this.#backlog              = [];
        this.#lastRenderedTextMode = null;
    }

    /**
     * Restaura los sprites activos al cargar una partida guardada.
     * Llamar desde Engine.resumeFromState().
     *
     * @param {Record<SpriteSlot, { actorId: string, path: string }>} savedSprites
     */
    async restoreSprites(savedSprites) {
        for (const [slot, { actorId, path }] of Object.entries(savedSprites)) {
            if (!this.#loadedCharacters.has(actorId)) {
                const characterData = await this.#db.characters.get(actorId);
                if (characterData) {
                    this.#loadedCharacters.set(actorId, new Character(characterData));
                }
            }
            this.#occupiedSlots[slot] = actorId;
            await this.#renderer.renderSprite(actorId, path, slot, 'none');
        }
    }

    // ── Despachador ────────────────────────────────────────────────────────

    /**
     * Ejecuta una instrucción Koedan.
     *
     * Cada case es responsable de llamar `this.#hooks.advance()` para encadenar
     * la instrucción siguiente, o `this.#hooks.setBlocked(true)` para esperar
     * input del jugador.
     *
     * Regla invariable: nunca llamar Engine.next() desde aquí —
     * siempre `this.#hooks.advance()` para evitar romper el re-entrancy guard.
     *
     * @param {import('./parser/Parser.js').ParsedInstruction} instruction
     */
    async dispatch(instruction) {
        switch (instruction.type) {

            // ── Personajes ─────────────────────────────────────────────────

            case 'PAWN_LOAD': {
                await this.#loadCharactersIntoMemory(instruction.names);
                await this.#hooks.advance();
                break;
            }

            case 'SPRITE_SHOW': {
                await this.#showCharacterSprite(instruction);
                await this.#hooks.advance();
                break;
            }

            case 'SPRITE_HIDE': {
                await this.#hideCharacterSprite(instruction);
                await this.#hooks.advance();
                break;
            }

            // ── Escena y audio ─────────────────────────────────────────────

            case 'BG_CHANGE': {
                await this.#renderer.changeBackground(
                    instruction.target, instruction.effect, instruction.time);
                this.#hooks.getState().visualState.bg = instruction.target;
                await this.#hooks.advance();
                break;
            }

            case 'AUDIO': {
                await this.#handleAudioInstruction(instruction);
                await this.#hooks.advance();
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
                await this.#hooks.advance();
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
                await this.#renderer.fxShake(parseDurationToMs(instruction.duration));
                await this.#hooks.advance();
                break;
            }

            case 'FX_FLASH': {
                await this.#renderer.fxFlash(
                    instruction.color, parseDurationToMs(instruction.duration));
                await this.#hooks.advance();
                break;
            }

            case 'FX_VIGNETTE': {
                this.#renderer.fxVignette(instruction.state === 'on');
                await this.#hooks.advance();
                break;
            }

            // ── Estado del juego ───────────────────────────────────────────

            case 'SET_FLAG': {
                this.#hooks.getState().setFlag(instruction.key, instruction.value);
                await this.#hooks.advance();
                break;
            }

            case 'INVENTORY_ADD': {
                this.#hooks.getState().addItem(instruction.item);
                await this.#hooks.advance();
                break;
            }

            case 'INVENTORY_REMOVE': {
                this.#hooks.getState().removeItem(instruction.item);
                await this.#hooks.advance();
                break;
            }

            case 'UNLOCK': {
                await this.#unlockGalleryCg(instruction);
                await this.#hooks.advance();
                break;
            }

            // ── Condicionales ──────────────────────────────────────────────

            case 'COND_JUMP': {
                // Engine ajusta currentIndex antes de llamar a dispatch,
                // pero la evaluación de la condición vive aquí porque
                // accede al state y al inventario.
                const conditionPasses = this.#evaluateCondition(instruction.condition);
                if (!conditionPasses) {
                    // Señalizamos el salto devolviendo el targetIndex.
                    // Engine lo aplica antes del siguiente advance.
                    return { jump: instruction.targetIndex };
                }
                await this.#hooks.advance();
                break;
            }

            case 'JUMP': {
                return { jump: instruction.targetIndex };
            }

            default: {
                console.warn(`[Executor] Instrucción desconocida: "${instruction.type}". Saltando.`);
                await this.#hooks.advance();
            }
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HANDLERS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    /** @param {string[]} characterIds */
    async #loadCharactersIntoMemory(characterIds) {
        for (const characterId of characterIds) {
            if (this.#loadedCharacters.has(characterId)) continue;
            const characterData = await this.#db.characters.get(characterId);
            if (characterData) {
                this.#loadedCharacters.set(characterId, new Character(characterData));
                console.log(`[Executor] Personaje "${characterId}" cargado.`);
            } else {
                console.error(`[Executor] Personaje "${characterId}" no encontrado en DB.`);
            }
        }
    }

    /** @param {object} instruction */
    async #showCharacterSprite(instruction) {
        const character = this.#loadedCharacters.get(instruction.actor);
        if (!character) {
            console.error(`[Executor] SPRITE_SHOW: "${instruction.actor}" no está cargado.`);
            return;
        }

        const spritePath = buildAssetUrl(character.getSprite(instruction.pose));

        this.#removeCharacterFromOccupiedSlots(instruction.actor);
        this.#occupiedSlots[instruction.slot] = instruction.actor;

        await this.#renderer.renderSprite(
            instruction.actor, spritePath, instruction.slot, instruction.effect);

        this.#hooks.getState().visualState.sprites[instruction.slot] = {
            actorId: instruction.actor,
            path:    spritePath,
        };
    }

    /** @param {object} instruction */
    async #hideCharacterSprite(instruction) {
        const occupiedSlot = this.#findSlotOccupiedByCharacter(instruction.actor);
        if (!occupiedSlot) return;

        await this.#renderer.hideSprite(instruction.actor, occupiedSlot, instruction.effect);

        this.#occupiedSlots[occupiedSlot] = null;
        delete this.#hooks.getState().visualState.sprites[occupiedSlot];
    }

    /** @param {object} instruction */
    async #handleAudioInstruction(instruction) {
        if (instruction.audioType === 'bgm') {
            const volume = parseFloat(instruction.vol ?? 0.5);
            this.#audio.playBGM(instruction.param, volume);
            this.#hooks.getState().visualState.bgm = { track: instruction.param, vol: volume };
        } else if (instruction.audioType === 'se') {
            this.#audio.playSE(instruction.param, parseFloat(instruction.vol ?? 0.8));
        }
    }

    /** @param {object} instruction */
    async #renderDialogueLine(instruction) {
        const character = this.#loadedCharacters.get(instruction.actor);

        if (this.#lastRenderedTextMode === 'narrate') {
            await this.#renderer.modeTransition(false);
        }

        this.#lastRenderedTextMode                   = 'dialogue';
        this.#hooks.getState().visualState.mode      = 'dialogue';

        if (instruction.pose && character) {
            const posePath   = buildAssetUrl(character.getSprite(instruction.pose));
            const activeSlot = this.#findSlotOccupiedByCharacter(instruction.actor);
            if (activeSlot) this.#renderer.updateSprite(instruction.actor, posePath, activeSlot);
        }

        if (instruction.vo && character) {
            this.#audio.playVoice(`${character.voicePrefix}${instruction.vo}.mp3`);
        }

        const speakerName = character ? character.name : instruction.actor;
        this.#pushToBacklog({ speaker: speakerName, text: instruction.text });

        this.#hooks.setBlocked(true);
        await this.#renderer.typewriter(speakerName, instruction.text, () => {
            this.#hooks.setBlocked(false);
            this.#hooks.onTextComplete();
        });
    }

    /** @param {object} instruction */
    async #renderNarrationLine(instruction) {
        if (this.#lastRenderedTextMode === 'dialogue') {
            await this.#renderer.modeTransition(true);
        }

        this.#lastRenderedTextMode              = 'narrate';
        this.#hooks.getState().visualState.mode = 'narrate';

        this.#pushToBacklog({ speaker: null, text: instruction.text });

        this.#hooks.setBlocked(true);
        await this.#renderer.typewriter(null, instruction.text, () => {
            this.#hooks.setBlocked(false);
            this.#hooks.onTextComplete();
        });
    }

    /** @param {string} duration */
    async #waitIfNotSkipping(duration) {
        if (this.#hooks.getSkipMode()) return;

        this.#hooks.setBlocked(true);
        await new Promise(resolve => setTimeout(resolve, parseDurationToMs(duration)));
        this.#hooks.setBlocked(false);
    }

    /** @param {object} instruction */
    async #openAndResolvePuzzle(instruction) {
        this.#hooks.setBlocked(true);

        const puzzleResolver = this.#hooks.getPuzzleResolver();
        let puzzlePassed     = false;

        if (puzzleResolver) {
            puzzlePassed = await puzzleResolver(instruction.puzzleId);
        } else {
            console.warn(`[Executor] Puzzle "${instruction.puzzleId}": puzzleResolver no inyectado.`);
        }

        const state = this.#hooks.getState();
        state.setFlag(`${instruction.puzzleId}_result`, String(puzzlePassed));
        this.#incrementPuzzleCounter(puzzlePassed);
        console.log(`[Executor] Puzzle "${instruction.puzzleId}" → ${puzzlePassed ? 'PASS' : 'FAIL'}`);

        state.visualState.mode = 'narrate';
        const resultText       = puzzlePassed ? instruction.passText : instruction.failText;

        await this.#renderer.typewriter(null, resultText, () => {
            this.#hooks.setBlocked(false);
            this.#hooks.onTextComplete();
        });
    }

    /** @param {object} instruction */
    async #navigateToScene(instruction) {
        const sceneLoader = this.#hooks.getSceneLoader();
        if (!sceneLoader) {
            this.#hooks.getState().currentFile = `${instruction.target}.dan`;
            console.warn(`[Executor] GOTO "${instruction.target}": sceneLoader no inyectado.`);
            return;
        }
        await sceneLoader(instruction.target, instruction.fadeColor ?? null);
    }

    /** @param {object} instruction */
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
        console.log(`[Executor] CG desbloqueado: "${instruction.cgId}"`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVALUADOR DE CONDICIONES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {object} condition
     * @returns {boolean}
     */
    #evaluateCondition(condition) {
        const state = this.#hooks.getState();

        if (condition.type === 'IF_INVENTORY') {
            return state.hasItem(condition.item);
        }

        if (condition.type === 'IF_FLAG') {
            const storedValue   = this.#coerceToNativeType(state.getFlag(condition.key, null));
            const expectedValue = this.#coerceToNativeType(condition.value);

            switch (condition.op) {
                case '==': return storedValue == expectedValue;
                case '!=': return storedValue != expectedValue;
                case '>':  return Number(storedValue) >  Number(expectedValue);
                case '<':  return Number(storedValue) <  Number(expectedValue);
                case '>=': return Number(storedValue) >= Number(expectedValue);
                case '<=': return Number(storedValue) <= Number(expectedValue);
                default:
                    console.warn(`[Executor] Operador desconocido: "${condition.op}"`);
                    return false;
            }
        }

        console.warn(`[Executor] Tipo de condición desconocido: "${condition.type}"`);
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

    /** @param {BacklogEntry} entry */
    #pushToBacklog(entry) {
        this.#backlog.push(entry);
        if (this.#backlog.length > BACKLOG_MAX_ENTRIES) this.#backlog.shift();
    }

    /** @param {boolean} puzzlePassed */
    #incrementPuzzleCounter(puzzlePassed) {
        const counterKey   = puzzlePassed ? 'puzzles_solved' : 'puzzles_failed';
        const state        = this.#hooks.getState();
        const currentCount = state.getFlag(counterKey, 0) ?? 0;
        state.setFlag(counterKey, String(Number(currentCount) + 1));
    }
}
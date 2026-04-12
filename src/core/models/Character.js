// src/core/models/Character.js

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PoseDefinition
 * @property {string|null} alias - Nombre usado en el script .dan (ej: 'neutral', 'triste')
 * @property {string|null} file  - Nombre del archivo relativo a basePath (sin extensión)
 */

/**
 * @typedef {Object} CharacterData
 * @property {string}            id
 * @property {string}            name
 * @property {string}            basePath    - Ruta base de sprites, ej: '/assets/sprites/v/'
 * @property {string}            voicePrefix - Prefijo de archivos de voz, ej: 'VAL_'
 * @property {PoseDefinition[]}  poses
 */

// ─── Character ────────────────────────────────────────────────────────────────

/**
 * Modelo de un personaje cargado en memoria desde la DB.
 *
 * Encapsula la resolución de sprites por alias de pose.
 * Se instancia desde `CharacterData` (objeto plano de Dexie) —
 * nunca se serializa de vuelta a la DB.
 *
 * @example
 * const character = new Character(characterData);
 * const spritePath = character.getSprite('neutral'); // '/assets/sprites/v/v_idle'
 */
export class Character {

    /** @type {string} */
    id;

    /** @type {string} — nombre visible en los diálogos */
    name;

    /** @type {string} — ruta base de la carpeta de sprites */
    basePath;

    /** @type {string} — prefijo de archivos de voz, ej: 'VAL_' → 'VAL_001.mp3' */
    voicePrefix;

    /** @type {PoseDefinition[]} — poses disponibles para este personaje */
    #poses;

    /** @param {CharacterData} characterData */
    constructor(characterData) {
        this.id          = characterData.id;
        this.name        = characterData.name;
        this.basePath    = characterData.basePath;
        this.voicePrefix = characterData.voicePrefix;

        // Normalizar a 8 slots — estructura fija del panel de personajes
        this.#poses = Array(8).fill(null).map((_, index) => ({
            alias: characterData.poses?.[index]?.alias ?? null,
            file:  characterData.poses?.[index]?.file  ?? null,
        }));
    }

    // ── API pública ────────────────────────────────────────────────────────

    /**
     * Devuelve la ruta del sprite para el alias de pose dado.
     * La ruta no incluye extensión — el Renderer prueba webp → png → jpg.
     *
     * @param   {string} poseAlias - ej: 'neutral', 'triste', 'sorpresa'
     * @returns {string}           - ej: '/assets/sprites/v/v_idle'
     * @throws  {Error}            - Si el alias no existe para este personaje
     */
    getSprite(poseAlias) {
        const matchingPose = this.#poses.find(pose => pose.alias === poseAlias);

        if (!matchingPose?.file) {
            throw new Error(`[Character] Pose "${poseAlias}" no definida para "${this.id}".`);
        }

        return `${this.basePath}${matchingPose.file}`;
    }
}
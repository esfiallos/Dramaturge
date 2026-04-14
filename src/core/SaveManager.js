// src/core/SaveManager.js

import { GameState } from './State.js';

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'autosave' | 'slot_1' | 'slot_2' | 'slot_3'} SaveSlotId
 */

/**
 * @typedef {Object} SlotSummary
 * @property {SaveSlotId} slotId
 * @property {number}     savedAt
 * @property {string}     currentFile
 * @property {number}     currentIndex
 */

/**
 * @typedef {Object} CgEntry
 * @property {string} id
 * @property {string} title
 * @property {string} path
 * @property {number} unlockedAt
 */

// ─── SaveManager ──────────────────────────────────────────────────────────────

/**
 * Gestiona la persistencia de partidas en Dexie (IndexedDB).
 *
 * Responsabilidades:
 * - Guardar y cargar `GameState` en slots predefinidos
 * - Exportar e importar partidas como archivos `.json`
 * - Eliminar slots individuales
 * - Consultar la galería de CGs desbloqueados
 *
 * No conoce al Engine ni al Renderer — opera exclusivamente con
 * objetos planos (`GameState.toJSON()` / `GameState.fromJSON()`).
 *
 * Slots disponibles:
 * - `autosave`                      — guardado automático tras cada diálogo
 * - `slot_1`, `slot_2`, `slot_3`   — slots manuales del jugador
 *
 * @example
 * const saveManager = new SaveManager(db);
 * await saveManager.save(engine.state, 'slot_1');
 * const restoredState = await saveManager.load('slot_1');
 */
export class SaveManager {

    /** @type {import('dexie').Dexie} */
    #db;

    /** @param {import('dexie').Dexie} db */
    constructor(db) {
        this.#db = db;
    }

    // ── Persistencia en Dexie ──────────────────────────────────────────────

    /**
     * Guarda el estado actual en el slot indicado.
     * Sobrescribe si el slot ya tenía datos.
     *
     * @param {GameState}   state
     * @param {SaveSlotId}  slotId
     * @returns {Promise<object>} — el snapshot guardado
     */
    async save(state, slotId = 'autosave') {
        const snapshot = {
            slotId,
            ...state.toJSON(),
            savedAt: Date.now(),
        };

        await this.#db.saves.put(snapshot);
        console.log(`[SaveManager] Guardado en "${slotId}".`);
        return snapshot;
    }

    /**
     * Carga un slot y devuelve una instancia de `GameState`.
     * Devuelve `null` si el slot está vacío.
     *
     * @param   {SaveSlotId}      slotId
     * @returns {Promise<GameState|null>}
     */
    async load(slotId = 'autosave') {
        const snapshot = await this.#db.saves.get(slotId);

        if (!snapshot) {
            console.warn(`[SaveManager] Slot "${slotId}" vacío.`);
            return null;
        }

        console.log(`[SaveManager] Cargado desde "${slotId}".`);
        return GameState.fromJSON(snapshot);
    }

    /**
     * Devuelve un resumen de todos los slots guardados, ordenados por fecha desc.
     * @returns {Promise<SlotSummary[]>}
     */
    async listSlots() {
        return this.#db.saves
            .orderBy('savedAt')
            .reverse()
            .toArray();
    }

    /**
     * Elimina un slot específico.
     * @param {SaveSlotId} slotId
     */
    async deleteSlot(slotId) {
        await this.#db.saves.delete(slotId);
        console.log(`[SaveManager] Slot "${slotId}" eliminado.`);
    }

    // ── Galería ────────────────────────────────────────────────────────────

    /**
     * Devuelve todos los CGs desbloqueados, ordenados por fecha de desbloqueo.
     *
     * Encapsula el acceso a la tabla `gallery` de IndexedDB. Los módulos
     * externos no necesitan saber que existe Dexie ni la estructura de la tabla.
     *
     * @returns {Promise<CgEntry[]>}
     */
    async listUnlockedCGs() {
        if (!this.#db.gallery) return [];
        return this.#db.gallery.orderBy('unlockedAt').toArray();
    }

    // ── Export / Import JSON ───────────────────────────────────────────────

    /**
     * Descarga el estado actual como archivo `.json`.
     * El nombre incluye la fecha para identificación fácil.
     * @param {GameState} state
     */
    exportToFile(state) {
        const snapshot      = state.toJSON();
        const jsonContent   = JSON.stringify(snapshot, null, 2);
        const exportDate    = new Date().toISOString().slice(0, 10);
        const downloadName  = `dramaturge_save_${exportDate}.json`;

        const blob          = new Blob([jsonContent], { type: 'application/json' });
        const downloadUrl   = URL.createObjectURL(blob);
        const anchorElement = document.createElement('a');

        anchorElement.href     = downloadUrl;
        anchorElement.download = downloadName;
        anchorElement.click();

        URL.revokeObjectURL(downloadUrl);
        console.log(`[SaveManager] Exportado como "${downloadName}".`);
    }

    /**
     * Abre un selector de archivo y devuelve el `GameState` importado.
     * Devuelve `null` si el jugador cancela o el archivo es inválido.
     * @returns {Promise<GameState|null>}
     */
    importFromFile() {
        return new Promise((resolve) => {
            const fileInput  = document.createElement('input');
            fileInput.type   = 'file';
            fileInput.accept = '.json';

            fileInput.onchange = async (changeEvent) => {
                const selectedFile = changeEvent.target.files[0];
                if (!selectedFile) { resolve(null); return; }

                try {
                    const fileContent    = await selectedFile.text();
                    const parsedSnapshot = JSON.parse(fileContent);
                    const restoredState  = GameState.fromJSON(parsedSnapshot);

                    console.log('[SaveManager] Partida importada correctamente.');
                    resolve(restoredState);

                } catch (parseError) {
                    console.error('[SaveManager] Archivo inválido:', parseError.message);
                    resolve(null);
                }
            };

            fileInput.click();
        });
    }
}
// src/core/SaveManager.js
//
// RESPONSABILIDAD:
//   Toda la persistencia de partidas. Nada fuera de este módulo
//   sabe que existe Dexie ni qué tablas hay en la DB.
//
// PARA AÑADIR UN NUEVO TIPO DE DATO PERSISTENTE:
//   Añadir un método aquí. Los módulos externos solo ven métodos
//   con nombres de dominio (listUnlockedCGs, deleteSlot…), nunca tablas.

import { GameState } from './State.js';

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'autosave' | 'slot_1' | 'slot_2' | 'slot_3'} SaveSlotId
 */

/**
 * @typedef {Object} CgEntry
 * @property {string} id
 * @property {string} title
 * @property {string} path
 * @property {number} unlockedAt
 */

// ─── SaveManager ──────────────────────────────────────────────────────────────

export class SaveManager {

    /** @type {import('dexie').Dexie} */
    #db;

    /** @param {import('dexie').Dexie} db */
    constructor(db) {
        this.#db = db;
    }

    // ── Partidas ───────────────────────────────────────────────────────────

    /**
     * Guarda el estado en el slot indicado. Sobrescribe si ya existía.
     * @param {GameState}  state
     * @param {SaveSlotId} slotId
     * @returns {Promise<object>} — el snapshot guardado
     */
    async save(state, slotId = 'autosave') {
        const snapshot = { slotId, ...state.toJSON(), savedAt: Date.now() };
        await this.#db.saves.put(snapshot);
        console.log(`[SaveManager] Guardado en "${slotId}".`);
        return snapshot;
    }

    /**
     * Carga un slot y devuelve un GameState, o null si está vacío.
     * @param   {SaveSlotId} slotId
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
     * Encapsula el acceso a la tabla `gallery` de IndexedDB.
     * MenuSystem nunca necesita saber que esa tabla existe.
     *
     * @returns {Promise<CgEntry[]>}
     */
    async listUnlockedCGs() {
        if (!this.#db.gallery) return [];
        return this.#db.gallery.orderBy('unlockedAt').toArray();
    }

    // ── Export / Import ────────────────────────────────────────────────────

    /**
     * Descarga el estado actual como archivo .json.
     * @param {GameState} state
     */
    exportToFile(state) {
        const json       = JSON.stringify(state.toJSON(), null, 2);
        const date       = new Date().toISOString().slice(0, 10);
        const filename   = `dramaturge_save_${date}.json`;
        const url        = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const anchor     = document.createElement('a');
        anchor.href      = url;
        anchor.download  = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        console.log(`[SaveManager] Exportado como "${filename}".`);
    }

    /**
     * Abre un selector de archivo y devuelve el GameState importado.
     * Devuelve null si el jugador cancela o el archivo es inválido.
     * @returns {Promise<GameState|null>}
     */
    importFromFile() {
        return new Promise((resolve) => {
            const input    = document.createElement('input');
            input.type     = 'file';
            input.accept   = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(null); return; }
                try {
                    const text = await file.text();
                    resolve(GameState.fromJSON(JSON.parse(text)));
                    console.log('[SaveManager] Partida importada correctamente.');
                } catch (err) {
                    console.error('[SaveManager] Archivo inválido:', err.message);
                    resolve(null);
                }
            };
            input.click();
        });
    }
}
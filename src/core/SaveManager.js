// src/core/SaveManager.js
//
// RESPONSABILIDADES:
//   1. Guardar y cargar partidas en Dexie (persistencia local)
//   2. Exportar partidas como archivo .json descargable
//   3. Importar partidas desde un archivo .json
//
// SLOTS PREDEFINIDOS:
//   'autosave'  → guardado automático tras cada diálogo
//   'slot_1'    → slot manual del jugador (expandible a slot_2, slot_3...)
//
// SaveManager NO conoce al Engine ni al Renderer.
// Solo maneja datos planos (GameState.toJSON()).

import { GameState } from './State.js';

export class SaveManager {
    constructor(db) {
        this.db = db;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEXIE — Persistencia local
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Guarda el estado actual en un slot.
     * @param {GameState} state  - Estado a guardar
     * @param {string}    slotId - Identificador del slot (ej: 'autosave', 'slot_1')
     */
    async save(state, slotId = 'autosave') {
        const snapshot = {
            slotId,
            ...state.toJSON(),
            savedAt: Date.now(), // DESPUÉS del spread — gana sobre state.savedAt
        };

        await this.db.saves.put(snapshot);
        console.log(`[SaveManager] Guardado en "${slotId}".`);
        return snapshot;
    }

    /**
     * Carga un slot y devuelve una instancia de GameState.
     * @param   {string}          slotId
     * @returns {GameState|null}
     */
    async load(slotId = 'autosave') {
        const data = await this.db.saves.get(slotId);
        if (!data) {
            console.warn(`[SaveManager] Slot "${slotId}" vacío.`);
            return null;
        }

        console.log(`[SaveManager] Cargado desde "${slotId}".`);
        return GameState.fromJSON(data);
    }

    /**
     * Devuelve la lista de todos los slots guardados, ordenados por fecha.
     * @returns {Array<{slotId, savedAt, currentFile, currentIndex}>}
     */
    async listSlots() {
        return await this.db.saves
            .orderBy('savedAt')
            .reverse()
            .toArray();
    }

    /**
     * Elimina un slot específico.
     * @param {string} slotId
     */
    async deleteSlot(slotId) {
        await this.db.saves.delete(slotId);
        console.log(`[SaveManager] Slot "${slotId}" eliminado.`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JSON — Exportar e importar partidas
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Descarga el estado actual como un archivo .json.
     * El nombre del archivo incluye la fecha para fácil identificación.
     * @param {GameState} state
     */
    exportToFile(state) {
        const data     = state.toJSON();
        const json     = JSON.stringify(data, null, 2);
        const blob     = new Blob([json], { type: 'application/json' });
        const url      = URL.createObjectURL(blob);

        const date     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const filename = `dramaturge_save_${date}.json`;

        const a   = document.createElement('a');
        a.href    = url;
        a.download = filename;
        a.click();

        // Liberar la URL del objeto inmediatamente
        URL.revokeObjectURL(url);
        console.log(`[SaveManager] Exportado como "${filename}".`);
    }

    /**
     * Importa un archivo .json y devuelve una instancia de GameState.
     * El jugador selecciona el archivo desde su sistema.
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
                    const text  = await file.text();
                    const data  = JSON.parse(text);
                    const state = GameState.fromJSON(data);
                    console.log('[SaveManager] Partida importada correctamente.');
                    resolve(state);
                } catch (err) {
                    console.error('[SaveManager] Error al importar:', err.message);
                    resolve(null);
                }
            };

            input.click();
        });
    }
}
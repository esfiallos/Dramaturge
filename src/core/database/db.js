// src/core/database/db.js

import Dexie from 'dexie';

// ─── DramaturgeDB ─────────────────────────────────────────────────────────────

/**
 * Base de datos local del motor. Usa Dexie v4 sobre IndexedDB.
 *
 * Tablas:
 * - `characters` — actores y sus poses. Gestionado desde `/dev/characters.html`.
 * - `puzzles`    — definición de puzzles del juego.
 * - `saves`      — partidas guardadas (autosave + 3 slots manuales).
 * - `gallery`    — CGs desbloqueados. Meta-progreso: sobrevive a nuevas partidas.
 *
 * Regla de migración:
 *   Nunca modificar una versión ya publicada.
 *   Siempre añadir `version(N+1)` con el schema completo.
 *   Dexie aplica la migración automáticamente en el primer arranque.
 *
 * Solo se declaran como índices los campos usados en `.where()` o `.get()`.
 * El resto de los campos se almacenan automáticamente sin declararlos.
 */
export const db = new Dexie('DramaturgeDB');

db.version(1).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    inventory:  'itemKey',
});

db.version(2).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    inventory:  'itemKey',
    saves:      'slotId, savedAt',
});

db.version(3).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    inventory:  'itemKey',
    saves:      'slotId, savedAt',
    gallery:    'id, unlockedAt',
});
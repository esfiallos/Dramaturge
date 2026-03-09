// src/core/database/db.js
import Dexie from 'dexie';

export const db = new Dexie('DramaturgeDB');

// ─── CONTRATO DE DATOS ────────────────────────────────────────────────────────
//
// REGLAS:
//   - Solo declarar campos como índice si se van a usar en .where() o .get().
//   - El resto de los campos se almacenan automáticamente sin declararlos aquí.
//   - Para agregar tablas nuevas: incrementar la versión y redeclarar TODAS las tablas.
//     Dexie maneja la migración automáticamente si no se eliminan tablas existentes.
//
// TABLA: characters
//   PK: id (string manual, ej: 'valeria') — permite db.characters.get('valeria') en O(1)
//
// TABLA: saves
//   PK: slotId (string, ej: 'slot_1', 'autosave')
//   savedAt: timestamp numérico — indexado para ordenar por fecha
//
// TABLA: puzzles / inventory — reservadas para uso futuro

db.version(1).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    inventory:  'itemKey',
});

// Versión 2: agrega la tabla de partidas guardadas.
// Dexie aplica la migración automáticamente en el primer arranque tras la actualización.
db.version(2).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    inventory:  'itemKey',
    saves:      'slotId, savedAt',
});
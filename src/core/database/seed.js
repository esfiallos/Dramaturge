// src/core/database/seed.js
//
// Seed de producción.
// Se ejecuta UNA SOLA VEZ cuando la DB está vacía (primera ejecución del juego).
//
// PARA AUDITAR / EDITAR PERSONAJES EN DEV → usar /dev/characters.html
//
// PARA AÑADIR UN PERSONAJE NUEVO:
//   1. Añadir su entrada en CHARACTERS
//   2. Poner sus sprites en /public/assets/sprites/{carpeta}/
//   3. Si ya corriste el juego antes, borrar la DB en DevTools → Application → IndexedDB
//      o añadir una nueva versión en db.js para migrar automáticamente.
//
// PARA AÑADIR UN PUZZLE NUEVO:
//   1. Añadir su entrada en PUZZLES con un puzzleId único (P01, P02, ...)
//   2. Referenciarlo en el script .dan con: puzzle P01 pass:"..." fail:"..."

// ─── Personajes ───────────────────────────────────────────────────────────────
//
// Estructura de cada personaje:
//   id          {string}  Identificador único. Usado en scripts: pawn valeria
//   name        {string}  Nombre mostrado en los diálogos.
//   basePath    {string}  Carpeta de sprites. Debe empezar y terminar con /
//   voicePrefix {string}  Prefijo de archivos de voz. Ej: VAL_ → VAL_001.mp3
//   poses       {Array}   Lista de { alias, file }
//                           alias → nombre usado en el script: valeria:triste
//                           file  → archivo relativo a basePath

const CHARACTERS = [
    {
        id:          'valeria',
        name:        'Valeria',
        basePath:    '/assets/sprites/v/',
        voicePrefix: 'VAL_',
        poses: [
            { alias: 'neutral',  file: 'v_idle.png'       },
            { alias: 'triste',   file: 'v_sad.png'         },
            { alias: 'sorpresa', file: 'v_surprised.png'   },
        ],
    },
    {
        id:          'miki',
        name:        'Miki',
        basePath:    '/assets/sprites/m/',
        voicePrefix: 'MIK_',
        poses: [
            { alias: 'neutral', file: 'm_idle.png'  },
            { alias: 'feliz',   file: 'm_happy.png' },
        ],
    },

    // ── Añadir nuevos personajes aquí ─────────────────────────────────────────
    // {
    //     id:          'guardian',
    //     name:        'El Guardián',
    //     basePath:    '/assets/sprites/g/',
    //     voicePrefix: 'GRD_',
    //     poses: [
    //         { alias: 'neutral', file: 'g_idle.png' },
    //     ],
    // },
];

// ─── Puzzles ──────────────────────────────────────────────────────────────────
//
// Tipos soportados:
//   MULTIPLE_CHOICE  { options: string[], answer: number (índice) }
//   FREE_TEXT        { answer: string (comparación case-insensitive) }
//   INVENTORY        { requiredItem: string (itemKey del inventario) }

const PUZZLES = [
    {
        puzzleId:    'P01',
        type:        'MULTIPLE_CHOICE',
        title:       'El Código del Bibliotecario',
        description: '¿Cuántos sellos tiene el sello mayor de la biblioteca antigua?',
        options:     ['Tres sellos', 'Siete sellos', 'Doce sellos'],
        answer:      1,
    },
    {
        puzzleId:    'P02',
        type:        'FREE_TEXT',
        title:       'La Contraseña Olvidada',
        description: 'En el margen del diario encontraste una pista: «el nombre del primer guardián».',
        answer:      'aldric',
    },
    {
        puzzleId:    'P03',
        type:        'INVENTORY',
        title:       'La Puerta Sellada',
        description: 'La puerta responde a la llave maestra.',
        requiredItem: 'llave_maestra',
    },

    // ── Añadir nuevos puzzles aquí ────────────────────────────────────────────
];

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Inserta los datos iniciales si la DB está vacía.
 * Idempotente: si ya hay personajes, no hace nada.
 *
 * @param {import('../database/db.js').DramaturgeDB} db
 * @returns {Promise<boolean>} true si se ejecutó el seed, false si ya había datos
 */
export async function seedProductionDB(db) {
    const count = await db.characters.count();
    if (count > 0) return false;

    console.log('[Seed] DB vacía — insertando datos iniciales...');

    await db.characters.bulkPut(CHARACTERS);
    await db.puzzles.bulkPut(PUZZLES);

    console.log(`[Seed] ✓ ${CHARACTERS.length} personaje(s) y ${PUZZLES.length} puzzle(s) insertados.`);
    return true;
}
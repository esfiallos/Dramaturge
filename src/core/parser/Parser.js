// src/core/parser/Parser.js
//
// PATRÓN: Table-Driven Parsing
//
// Las reglas viven en PARSE_RULES como datos, no como código.
// El método parse() es un loop genérico que nunca necesita modificarse.
//
// PARA AÑADIR UNA REGLA NUEVA:
//   1. Añadir el regex en Grammar.js
//   2. Añadir una entrada en PARSE_RULES (aquí abajo)
//   3. Añadir el case en Engine.js execute()
//   — parse() no se toca.

import { EMS_GRAMMAR } from './Grammar.js';

// ─── Tabla de reglas ──────────────────────────────────────────────────────────
//
// Campos:
//   regex     {RegExp}   — patrón a matchear contra la línea
//   type      {string}   — tipo de instrucción que produce
//   transform {Function} — (opcional) transforma match.groups antes de guardar.
//                          Si no se define, se usa match.groups directamente.
//
// ORDEN: más específico primero.
//   - INVENTORY_ADD y INVENTORY_REMOVE van antes que SET_FLAG (ambas empiezan con 'set')
//   - NARRATE va antes que DIALOGUE (no tiene actor:pose, pero el regex no colisiona)
//   - PUZZLE y GOTO van antes que GOTO para evitar prefijos comunes

const PARSE_RULES = [

    // ── Personajes ────────────────────────────────────────────────────────────
    {
        regex:     EMS_GRAMMAR.PAWN_INSTANTIATE,
        type:      'PAWN_LOAD',
        transform: (g) => ({ names: g.names.split(',').map(n => n.trim()) }),
    },
    { regex: EMS_GRAMMAR.SHOW, type: 'SPRITE_SHOW' },
    { regex: EMS_GRAMMAR.HIDE, type: 'SPRITE_HIDE' },

    // ── Diálogo y narración ───────────────────────────────────────────────────
    { regex: EMS_GRAMMAR.DIALOGUE, type: 'DIALOGUE' },
    { regex: EMS_GRAMMAR.NARRATE,  type: 'NARRATE'  },

    // ── Escena y audio ────────────────────────────────────────────────────────
    { regex: EMS_GRAMMAR.BG_COMMAND,    type: 'BG_CHANGE' },
    { regex: EMS_GRAMMAR.AUDIO_COMMAND, type: 'AUDIO'     },

    // ── Control de flujo ──────────────────────────────────────────────────────
    { regex: EMS_GRAMMAR.WAIT,   type: 'WAIT'   },
    { regex: EMS_GRAMMAR.PUZZLE, type: 'PUZZLE' },
    { regex: EMS_GRAMMAR.GOTO,   type: 'GOTO'   },

    // ── Estado (orden: más específico primero dentro del grupo 'set') ─────────
    { regex: EMS_GRAMMAR.INVENTORY_ADD,    type: 'INVENTORY_ADD'    },
    { regex: EMS_GRAMMAR.INVENTORY_REMOVE, type: 'INVENTORY_REMOVE' },
    { regex: EMS_GRAMMAR.SET_FLAG,         type: 'SET_FLAG'         },

    // ── Condicionales (marcadores de bloque — el segundo pase los compila a saltos) ──
    { regex: EMS_GRAMMAR.IF_FLAG,      type: 'IF_FLAG'      },
    { regex: EMS_GRAMMAR.IF_INVENTORY, type: 'IF_INVENTORY' },
    { regex: EMS_GRAMMAR.ELSE,         type: 'ELSE'         },
    { regex: EMS_GRAMMAR.ENDIF,        type: 'ENDIF'        },
];

// ─── Parser ───────────────────────────────────────────────────────────────────

export class EParser {

    parse(rawScript) {
        const lines = rawScript.trim().split('\n');
        console.log(`[Parser] Procesando ${lines.length} líneas...`);

        // ── Pase 1: matchear cada línea contra las reglas ─────────────────────
        const raw = [];
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            const instruction = this._matchLine(trimmed, index);
            raw.push(instruction);

            if (instruction.type === 'UNKNOWN') {
                console.warn(`[Parser] Línea ${index + 1} no reconocida: "${trimmed}"`);
            }
        });

        // ── Pase 2: resolver bloques if/else/endif en saltos con índices ──────
        const instructions = this._resolveBlocks(raw);

        console.log('[Parser] Árbol generado:', instructions);
        return instructions;
    }

    /**
     * Convierte los marcadores IF/ELSE/ENDIF en instrucciones de salto con
     * índices precalculados. El engine no necesita saber nada de bloques.
     *
     * IF_FLAG   { condition } → COND_JUMP { condition, targetIndex }
     *   ... cuerpo del if ...
     * ELSE                    → JUMP      { targetIndex }
     *   ... cuerpo del else ...
     * ENDIF                   → (eliminado)
     *
     * Si no hay ELSE:
     * IF_FLAG   { condition } → COND_JUMP { condition, targetIndex: índice tras ENDIF }
     *   ... cuerpo ...
     * ENDIF                   → (eliminado)
     *
     * Los bloques pueden anidarse.
     */
    _resolveBlocks(raw) {
        const out   = [];
        const stack = []; // stack de { jumpIndex, hasElse }

        for (let i = 0; i < raw.length; i++) {
            const inst = raw[i];

            if (inst.type === 'IF_FLAG' || inst.type === 'IF_INVENTORY') {
                // Emitir COND_JUMP con targetIndex pendiente (se rellena al encontrar ELSE/ENDIF)
                const jumpInst = {
                    type:        'COND_JUMP',
                    condition:   inst,     // instrucción original con key/op/value
                    targetIndex: -1,       // pendiente
                    line:        inst.line,
                };
                stack.push({ jumpIdx: out.length, hasElse: false });
                out.push(jumpInst);

            } else if (inst.type === 'ELSE') {
                const frame = stack[stack.length - 1];
                if (!frame) {
                    console.error(`[Parser] ELSE sin IF en línea ${inst.line + 1}`);
                    continue;
                }
                // El COND_JUMP del IF ahora apunta al índice siguiente (tras este JUMP)
                // Emitir un JUMP incondicional para saltar el cuerpo del else
                const jumpInst = {
                    type:        'JUMP',
                    targetIndex: -1,   // pendiente — se rellena al encontrar ENDIF
                    line:        inst.line,
                };
                // Fijar target del COND_JUMP al índice que tendrá el JUMP + 1
                out[frame.jumpIdx].targetIndex = out.length + 1;
                frame.jumpIdx  = out.length; // ahora rastreamos el JUMP del else
                frame.hasElse  = true;
                out.push(jumpInst);

            } else if (inst.type === 'ENDIF') {
                const frame = stack.pop();
                if (!frame) {
                    console.error(`[Parser] ENDIF sin IF en línea ${inst.line + 1}`);
                    continue;
                }
                // Fijar el target del último jump pendiente al índice actual (tras endif)
                out[frame.jumpIdx].targetIndex = out.length;
                // ENDIF no emite instrucción — se elimina

            } else {
                out.push(inst);
            }
        }

        if (stack.length > 0) {
            console.error(`[Parser] ${stack.length} bloque(s) if sin cerrar con endif.`);
        }

        return out;
    }

    /**
     * Intenta matchear una línea contra todas las reglas en orden.
     * Devuelve la instrucción resultante, o tipo UNKNOWN si ninguna aplica.
     * @param   {string} line  - Línea ya trimmed
     * @param   {number} index - Número de línea (para debug)
     * @returns {object}       - Instrucción { type, ...data, line }
     */
    _matchLine(line, index) {
        for (const rule of PARSE_RULES) {
            const match = line.match(rule.regex);
            if (!match) continue;

            const data = rule.transform
                ? rule.transform(match.groups)
                : { ...match.groups };

            return { type: rule.type, ...data, line: index };
        }

        return { type: 'UNKNOWN', raw: line, line: index };
    }
}
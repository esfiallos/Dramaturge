// src/core/parser/Parser.js

import { KDN_GRAMMAR } from './Grammar.js';

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ParseRule
 * @property {RegExp}                               regex
 * @property {string}                               type
 * @property {((groups: Record<string,string>) => Record<string,*>)|undefined} transform
 */

/**
 * @typedef {Object} RawInstruction
 * @property {string} type
 * @property {number} line
 */

/**
 * @typedef {Object} ConditionalFrame
 * @property {number}  jumpIdx  - Índice en `out` del COND_JUMP o JUMP pendiente
 * @property {boolean} hasElse  - Si ya se procesó un ELSE para este bloque
 */

// ─── Tabla de reglas ──────────────────────────────────────────────────────────

/**
 * Reglas de parseo en orden de aplicación.
 *
 * El orden importa — las reglas más específicas van primero:
 * - INVENTORY_ADD y INVENTORY_REMOVE antes que SET_FLAG (ambas empiezan con `set`)
 * - NARRATE antes que DIALOGUE (distintos prefijos, no colisionan)
 *
 * Para añadir una instrucción nueva: añadir una entrada aquí y el case en Engine.js.
 *
 * @type {ParseRule[]}
 */
const PARSE_RULES = [

    // ── Personajes ─────────────────────────────────────────────────────────
    {
        regex:     KDN_GRAMMAR.PAWN_INSTANTIATE,
        type:      'PAWN_LOAD',
        transform: (groups) => ({ names: groups.names.split(',').map(name => name.trim()) }),
    },
    { regex: KDN_GRAMMAR.SHOW, type: 'SPRITE_SHOW' },
    { regex: KDN_GRAMMAR.HIDE, type: 'SPRITE_HIDE' },

    // ── Diálogo y narración ────────────────────────────────────────────────
    { regex: KDN_GRAMMAR.DIALOGUE, type: 'DIALOGUE' },
    { regex: KDN_GRAMMAR.NARRATE,  type: 'NARRATE'  },

    // ── Escena y audio ─────────────────────────────────────────────────────
    { regex: KDN_GRAMMAR.BG_COMMAND,    type: 'BG_CHANGE' },
    { regex: KDN_GRAMMAR.AUDIO_COMMAND, type: 'AUDIO'     },

    // ── Control de flujo ───────────────────────────────────────────────────
    { regex: KDN_GRAMMAR.WAIT,   type: 'WAIT'   },
    { regex: KDN_GRAMMAR.PUZZLE, type: 'PUZZLE' },
    { regex: KDN_GRAMMAR.GOTO,   type: 'GOTO'   },

    // ── Efectos de pantalla ────────────────────────────────────────────────
    { regex: KDN_GRAMMAR.FX_SHAKE,    type: 'FX_SHAKE'    },
    { regex: KDN_GRAMMAR.FX_FLASH,    type: 'FX_FLASH'    },
    { regex: KDN_GRAMMAR.FX_VIGNETTE, type: 'FX_VIGNETTE' },

    // ── Estado — más específico primero dentro del grupo `set` ────────────
    { regex: KDN_GRAMMAR.INVENTORY_ADD,    type: 'INVENTORY_ADD'    },
    { regex: KDN_GRAMMAR.INVENTORY_REMOVE, type: 'INVENTORY_REMOVE' },
    { regex: KDN_GRAMMAR.SET_FLAG,         type: 'SET_FLAG'         },
    { regex: KDN_GRAMMAR.UNLOCK,           type: 'UNLOCK'           },

    // ── Condicionales — compilados a saltos en el segundo pase ────────────
    { regex: KDN_GRAMMAR.IF_FLAG,      type: 'IF_FLAG'      },
    { regex: KDN_GRAMMAR.IF_INVENTORY, type: 'IF_INVENTORY' },
    { regex: KDN_GRAMMAR.ELSE,         type: 'ELSE'         },
    { regex: KDN_GRAMMAR.ENDIF,        type: 'ENDIF'        },
];

// ─── KParser ──────────────────────────────────────────────────────────────────

/**
 * Parser Table-Driven para scripts Koedan (.dan).
 *
 * Proceso en dos pases:
 *   1. **Match** — cada línea se compara contra `PARSE_RULES` en orden,
 *      produciendo un array plano de instrucciones tipadas.
 *   2. **Resolve** — los marcadores `IF/ELSE/ENDIF` se convierten en
 *      instrucciones de salto (`COND_JUMP` / `JUMP`) con índices absolutos.
 *      El Engine ejecuta saltos directamente sin conocer la estructura de bloques.
 *
 * Para añadir una instrucción nueva: solo tocar `Grammar.js`, `PARSE_RULES` y `Engine.js`.
 * Este método `parse()` nunca necesita modificarse.
 *
 * @example
 * const parser = new KParser();
 * const instructions = parser.parse(rawScriptText);
 * await engine.loadScript(instructions);
 */
export class KParser {

    /**
     * Parsea un script .dan completo y devuelve el array de instrucciones listo
     * para ser ejecutado por el Engine.
     *
     * @param   {string}            rawScript - Contenido completo del archivo .dan
     * @returns {RawInstruction[]}
     */
    parse(rawScript) {
        const scriptLines = rawScript.trim().split('\n');
        console.log(`[Parser] Procesando ${scriptLines.length} líneas...`);

        const rawInstructions    = this.#matchAllLines(scriptLines);
        const compiledInstructions = this.#compileConditionalBlocks(rawInstructions);

        console.log('[Parser] Árbol generado:', compiledInstructions);
        return compiledInstructions;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASE 1 — Match de líneas
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param   {string[]}          lines
     * @returns {RawInstruction[]}
     */
    #matchAllLines(lines) {
        const instructions = [];

        lines.forEach((rawLine, lineIndex) => {
            const trimmedLine = rawLine.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) return;

            const instruction = this.#matchSingleLine(trimmedLine, lineIndex);
            instructions.push(instruction);

            if (instruction.type === 'UNKNOWN') {
                console.warn(`[Parser] Línea ${lineIndex + 1} no reconocida: "${trimmedLine}"`);
            }
        });

        return instructions;
    }

    /**
     * Compara una línea contra todas las reglas en orden.
     * Devuelve la primera que coincida, o tipo UNKNOWN si ninguna aplica.
     *
     * @param   {string}          trimmedLine
     * @param   {number}          lineIndex
     * @returns {RawInstruction}
     */
    #matchSingleLine(trimmedLine, lineIndex) {
        for (const rule of PARSE_RULES) {
            const match = trimmedLine.match(rule.regex);
            if (!match) continue;

            const extractedData = rule.transform
                ? rule.transform(match.groups)
                : { ...match.groups };

            return { type: rule.type, ...extractedData, line: lineIndex };
        }

        return { type: 'UNKNOWN', raw: trimmedLine, line: lineIndex };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASE 2 — Compilación de bloques condicionales
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Convierte los marcadores `IF/ELSE/ENDIF` en instrucciones de salto
     * con índices absolutos precalculados.
     *
     * Resultado para un bloque `if/else/endif`:
     *   IF_FLAG   → COND_JUMP { targetIndex: índice del JUMP+1 }
     *   ...cuerpo del if...
     *   ELSE      → JUMP      { targetIndex: índice tras ENDIF }
     *   ...cuerpo del else...
     *   ENDIF     → (eliminado)
     *
     * Resultado para un bloque `if/endif` sin else:
     *   IF_FLAG   → COND_JUMP { targetIndex: índice tras ENDIF }
     *   ...cuerpo...
     *   ENDIF     → (eliminado)
     *
     * @param   {RawInstruction[]} rawInstructions
     * @returns {RawInstruction[]}
     */
    #compileConditionalBlocks(rawInstructions) {
        const compiledOutput       = [];
        const pendingJumpsStack    = []; // @type {ConditionalFrame[]}

        for (const instruction of rawInstructions) {

            if (instruction.type === 'IF_FLAG' || instruction.type === 'IF_INVENTORY') {
                const conditionalJump = {
                    type:        'COND_JUMP',
                    condition:   instruction,
                    targetIndex: -1, // se rellena al encontrar ELSE o ENDIF
                    line:        instruction.line,
                };
                pendingJumpsStack.push({ jumpIdx: compiledOutput.length, hasElse: false });
                compiledOutput.push(conditionalJump);

            } else if (instruction.type === 'ELSE') {
                const currentFrame = pendingJumpsStack[pendingJumpsStack.length - 1];
                if (!currentFrame) {
                    console.error(`[Parser] ELSE sin IF en línea ${instruction.line + 1}`);
                    continue;
                }

                const unconditionalJump = {
                    type:        'JUMP',
                    targetIndex: -1, // se rellena al encontrar ENDIF
                    line:        instruction.line,
                };

                // El COND_JUMP del IF apunta al índice siguiente al JUMP del ELSE
                compiledOutput[currentFrame.jumpIdx].targetIndex = compiledOutput.length + 1;
                currentFrame.jumpIdx = compiledOutput.length;
                currentFrame.hasElse = true;
                compiledOutput.push(unconditionalJump);

            } else if (instruction.type === 'ENDIF') {
                const currentFrame = pendingJumpsStack.pop();
                if (!currentFrame) {
                    console.error(`[Parser] ENDIF sin IF en línea ${instruction.line + 1}`);
                    continue;
                }

                // El último jump pendiente apunta al índice actual (tras el ENDIF)
                compiledOutput[currentFrame.jumpIdx].targetIndex = compiledOutput.length;
                // ENDIF no emite instrucción — se elimina del output

            } else {
                compiledOutput.push(instruction);
            }
        }

        if (pendingJumpsStack.length > 0) {
            console.error(`[Parser] ${pendingJumpsStack.length} bloque(s) if sin cerrar con endif.`);
        }

        return compiledOutput;
    }
}
// src/core/parser/Grammar.js

/**
 * Expresiones regulares del lenguaje Koedan (.dan).
 *
 * Cada entrada usa named groups (`?<nombre>`) para que el Parser
 * pueda extraer los valores por nombre sin depender de índices posicionales.
 *
 * Para añadir una instrucción nueva al lenguaje:
 *   1. Definir el regex aquí con named groups
 *   2. Añadir la entrada en `PARSE_RULES` (Parser.js)
 *   3. Añadir el `case` correspondiente en `Engine.js`
 *
 * @type {Record<string, RegExp>}
 */
export const KDN_GRAMMAR = {

    // ── Personajes ────────────────────────────────────────────────────────────
    // pawn valeria
    // pawn valeria, miki, aldric
    PAWN_INSTANTIATE: /^pawn\s+(?<names>.+)/,

    // show valeria:neutral at center
    // show valeria:neutral at left fade
    // show miki:neutral at right slide
    SHOW: /^show\s+(?<actor>\w+):(?<pose>\w+)\s+at\s+(?<slot>\w+)(?:\s+(?<effect>\w+))?/,

    // hide valeria
    // hide valeria fade
    HIDE: /^hide\s+(?<actor>\w+)(?:\s+(?<effect>\w+))?/,

    // ── Diálogo y narración ───────────────────────────────────────────────────
    // valeria:neutral "Texto del diálogo."
    // valeria:triste  "Texto." [001]
    DIALOGUE: /^(?<actor>\w+):(?<pose>\w+)\s+"(?<text>[^"]+)"(?:\s+\[(?<vo>\w+)\])?/s,

    // narrate "Texto de narración sin personaje."
    NARRATE: /^narrate\s+"(?<text>[^"]+)"/,

    // ── Escena ────────────────────────────────────────────────────────────────
    // bg.set forest
    // bg.set mansion fade 2s
    // bg.set void fade:500ms
    BG_COMMAND: /^bg\.set\s+(?<target>\w+)(?:\s+(?<effect>\w+)(?:[:\s](?<time>[\d.]+s?))?)?/,

    // ── Audio ─────────────────────────────────────────────────────────────────
    // audio.bgm play[track_01]
    // audio.bgm play[track_01] vol:0.4
    // audio.se  play[rain_ambience] 0.7
    AUDIO_COMMAND: /^audio\.(?<audioType>bgm|se)\s+(?<action>\w+)\[(?<param>[^\]]+)\](?:\s+(?:vol:)?(?<vol>[\d.]+))?/,

    // ── Control de flujo ──────────────────────────────────────────────────────
    // wait 2s  |  wait 500ms  |  wait 1.5s
    WAIT: /^wait\s+(?<duration>\d+(?:\.\d+)?(?:s|ms))/,

    // puzzle P01 pass:"¡Lo lograste!" fail:"Casi. Sigamos."
    PUZZLE: /^puzzle\s+(?<puzzleId>\w+)\s+pass:"(?<passText>[^"]+)"\s+fail:"(?<failText>[^"]+)"/,

    // goto cap01/scene_02
    // goto cap02/scene_01 fade:black
    // goto cap02/scene_01 fade:white
    GOTO: /^goto\s+(?<target>[\w/]+)(?:\s+fade:(?<fadeColor>black|white))?/,

    // ── Efectos de pantalla ───────────────────────────────────────────────────
    // fx shake 0.4s
    FX_SHAKE: /^fx\s+shake\s+(?<duration>\d+(?:\.\d+)?(?:s|ms))/,

    // fx flash white 0.3s  |  fx flash black 0.5s
    FX_FLASH: /^fx\s+flash\s+(?<color>white|black)\s+(?<duration>\d+(?:\.\d+)?(?:s|ms))/,

    // fx vignette on  |  fx vignette off
    FX_VIGNETTE: /^fx\s+vignette\s+(?<state>on|off)/,

    // ── Estado del juego ──────────────────────────────────────────────────────
    // set flag.cap01_completo = true
    // set flag.intentos = 3
    SET_FLAG: /^set\s+flag\.(?<key>\w+)\s*=\s*(?<value>true|false|\d+(?:\.\d+)?|\w+)/,

    // set inventory.add llave_maestra
    INVENTORY_ADD: /^set\s+inventory\.add\s+(?<item>\w+)/,

    // set inventory.remove llave_maestra
    INVENTORY_REMOVE: /^set\s+inventory\.remove\s+(?<item>\w+)/,

    // ── Galería ───────────────────────────────────────────────────────────────
    // unlock cg_01
    // unlock cg_reunion title:"La reunión"
    UNLOCK: /^unlock\s+(?<cgId>\w+)(?:\s+title:"(?<title>[^"]+)")?/,

    // ── Condicionales ─────────────────────────────────────────────────────────
    // Operadores soportados: == != > < >= <=
    // if flag.miki_confio == true
    // if flag.intentos > 3
    IF_FLAG: /^if\s+flag\.(?<key>\w+)\s*(?<op>==|!=|>=|<=|>|<)\s*(?<value>true|false|\d+(?:\.\d+)?|\w+)/,

    // if inventory.has llave_maestra
    IF_INVENTORY: /^if\s+inventory\.has\s+(?<item>\w+)/,

    ELSE:  /^else$/,
    ENDIF: /^endif$/,
};
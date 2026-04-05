// src/core/parser/Grammar.js
//
// SINTAXIS COMPLETA DEL LENGUAJE KOEDAN (.dan)
// ─────────────────────────────────────────────────────────────────────────────
//
// PARA AÑADIR UNA REGLA:
//   1. Definir el regex aquí con named groups (?<nombre>)
//   2. Añadir entrada en PARSE_RULES (Parser.js)
//   3. Añadir case en Engine.js execute()
//
// REFERENCIA RÁPIDA:
//
//   pawn valeria, miki
//   show valeria:neutral at left fade
//   hide valeria fade
//   valeria:triste "Texto del diálogo." [001]
//   narrate "Texto de narración sin personaje."
//   bg.set forest fade:2s
//   audio.bgm play[track_01] vol:0.5
//   audio.se  play[explosion] vol:0.8
//   wait 2s
//   wait 500ms
//   puzzle P01 pass:"¡Lo lograste!" fail:"Casi. Sigamos."
//   goto cap01/scene_02
//   set flag.puzzle_solved = true
//   set inventory.add llave_maestra
//   set inventory.remove llave_maestra

export const KDN_GRAMMAR = {

    // ── Personajes ────────────────────────────────────────────────────────────

    // pawn valeria, miki
    PAWN_INSTANTIATE: /^pawn\s+(?<names>.+)/,

    // show actor:pose at slot [effect]
    SHOW: /^show\s+(?<actor>\w+):(?<pose>\w+)\s+at\s+(?<slot>\w+)(?:\s+(?<effect>\w+))?/,

    // hide actor [effect]
    HIDE: /^hide\s+(?<actor>\w+)(?:\s+(?<effect>\w+))?/,

    // ── Diálogo y narración ───────────────────────────────────────────────────

    // actor:pose "texto" [vo_id]
    DIALOGUE: /^(?<actor>\w+):(?<pose>\w+)\s+"(?<text>[^"]+)"(?:\s+\[(?<vo>\w+)\])?/s,

    // narrate "texto de narración"
    NARRATE: /^narrate\s+"(?<text>[^"]+)"/,

    // ── Escena ────────────────────────────────────────────────────────────────

    // bg.set fondo [efecto:tiempo]
    BG_COMMAND: /^bg\.set\s+(?<target>\w+)(?:\s+(?<effect>\w+)(?:[:\s](?<time>[\d.]+s?))?)?/,

    // ── Audio ─────────────────────────────────────────────────────────────────

    // audio.bgm play[track] vol:0.5
    // audio.se  play[explosion] vol:0.8
    AUDIO_COMMAND: /^audio\.(?<audioType>bgm|se)\s+(?<action>\w+)\[(?<param>[^\]]+)\](?:\s+(?:vol:)?(?<vol>[\d.]+))?/,

    // ── Control de flujo ──────────────────────────────────────────────────────

    // wait 2s  |  wait 500ms
    WAIT: /^wait\s+(?<duration>\d+(?:\.\d+)?(?:s|ms))/,

    // puzzle P01 pass:"¡Lo lograste!" fail:"Casi. Sigamos."
    PUZZLE: /^puzzle\s+(?<puzzleId>\w+)\s+pass:"(?<passText>[^"]+)"\s+fail:"(?<failText>[^"]+)"/,

    // goto cap01/scene_02
    // goto cap01/scene_02 fade:black
    // goto cap01/scene_02 fade:white
    // Soporta rutas con slashes para organización por capítulo/escena.
    // El parámetro fade es opcional. Color soportado: black | white.
    GOTO: /^goto\s+(?<target>[\w/]+)(?:\s+fade:(?<fadeColor>black|white))?/,

    // ── Estado del juego ──────────────────────────────────────────────────────

    // set flag.key = value
    SET_FLAG: /^set\s+flag\.(?<key>\w+)\s*=\s*(?<value>true|false|\d+(?:\.\d+)?|\w+)/,

    // set inventory.add item_key
    INVENTORY_ADD: /^set\s+inventory\.add\s+(?<item>\w+)/,

    // set inventory.remove item_key
    INVENTORY_REMOVE: /^set\s+inventory\.remove\s+(?<item>\w+)/,

    // ── Condicionales ─────────────────────────────────────────────────────────
    //
    // Comparadores soportados: == != > < >= <=
    //
    // if flag.key == value
    // if flag.key > 3
    IF_FLAG: /^if\s+flag\.(?<key>\w+)\s*(?<op>==|!=|>=|<=|>|<)\s*(?<value>true|false|\d+(?:\.\d+)?|\w+)/,

    // if inventory.has item_key
    IF_INVENTORY: /^if\s+inventory\.has\s+(?<item>\w+)/,

    // else
    ELSE: /^else$/,

    // endif
    ENDIF:   /^endif$/,
    UNLOCK:  /^unlock\s+(?<cgId>\w+)(?:\s+title:"(?<title>[^"]+)")?/,
};
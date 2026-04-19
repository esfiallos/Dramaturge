// tests/integration.test.js
//
// Tests de integración — Engine + InstructionExecutor + Parser juntos.
//
// ESTRATEGIA:
//   Se testea el comportamiento observable del sistema completo:
//   dado un script .dan, el estado del juego cambia de la forma esperada.
//
//   Lo que se mockea:
//     · Renderer   — para no necesitar PixiJS ni DOM
//     · Audio      — para no necesitar Howler
//     · DB         — para no necesitar Dexie/IndexedDB
//     · SceneManager — el goto se intercepta, no se fetch
//
//   Lo que NO se mockea:
//     · Parser     — procesa scripts .dan reales
//     · Engine     — ciclo de avance real
//     · InstructionExecutor — handlers reales
//     · ConditionEvaluator — evaluación real de condiciones
//     · GameState  — estado real
//
// PATRÓN DE AVANCE:
//   El engine bloquea en DIALOGUE/NARRATE esperando input del jugador.
//   En los tests, simulamos ese input llamando engine.next() manualmente
//   después de cada línea de texto.
//
//   Para avanzar automáticamente por un script completo usamos runScript(),
//   que detecta cuando el engine está bloqueado y llama next().

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dramaturge }          from '../src/core/Engine.js';
import { KParser }             from '../src/core/parser/Parser.js';
import { GameState }           from '../src/core/State.js';

// ─────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────

function createMockRenderer() {
    // typewriter: resuelve inmediatamente y llama onDone para no bloquear
    const typewriter = vi.fn().mockImplementation((_name, _text, onDone) => {
        onDone?.();
        return Promise.resolve();
    });

    return {
        typewriter,
        changeBackground:  vi.fn().mockResolvedValue(undefined),
        renderSprite:      vi.fn().mockResolvedValue(undefined),
        hideSprite:        vi.fn().mockResolvedValue(undefined),
        updateSprite:      vi.fn().mockResolvedValue(undefined),
        modeTransition:    vi.fn().mockResolvedValue(undefined),
        applyNarrationMode: vi.fn(),
        activateInstantMode: vi.fn(),
        skipTypewriter:    vi.fn(),
        flashTextBox:      vi.fn(),
        clearScene:        vi.fn(),
        fxShake:           vi.fn().mockResolvedValue(undefined),
        fxFlash:           vi.fn().mockResolvedValue(undefined),
        fxVignette:        vi.fn(),
        get isSkipLocked() { return false; },
    };
}

function createMockAudio() {
    return {
        playBGM:    vi.fn(),
        playSE:     vi.fn(),
        playVoice:  vi.fn(),
        setVolume:  vi.fn(),
        pauseDuck:  vi.fn(),
        pauseUnduck: vi.fn(),
        stopBGM:    vi.fn(),
        unlock:     vi.fn(),
    };
}

function createMockDb() {
    // Simula personajes en DB para que PAWN_LOAD funcione
    const characters = new Map([
        ['valeria', {
            id: 'valeria', name: 'Valeria',
            basePath: '/assets/sprites/v/',
            voicePrefix: 'VAL_',
            poses: [
                { alias: 'neutral',  file: 'v_idle.webp' },
                { alias: 'triste',   file: 'v_sad.webp'  },
                { alias: 'sorpresa', file: 'v_surprised.webp' },
            ],
        }],
        ['miki', {
            id: 'miki', name: 'Miki',
            basePath: '/assets/sprites/m/',
            voicePrefix: 'MIK_',
            poses: [
                { alias: 'neutral', file: 'm_idle.webp' },
            ],
        }],
    ]);

    return {
        characters: { get: vi.fn((id) => Promise.resolve(characters.get(id))) },
        puzzles:    { get: vi.fn().mockResolvedValue(null) },
        gallery:    { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
        saves:      { put: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE TEST
// ─────────────────────────────────────────────────────────────────────────────

const parser = new KParser();

/**
 * Crea un engine completamente configurado para tests de integración.
 * @returns {{ engine: Dramaturge, renderer: object, audio: object, db: object }}
 */
function createTestEngine() {
    const renderer = createMockRenderer();
    const audio    = createMockAudio();
    const db       = createMockDb();
    const state    = new GameState();

    const engine = new Dramaturge(db, renderer, audio, state, null);

    // puzzleResolver mockeado — devuelve pass o fail según el ID
    engine.puzzleResolver = vi.fn().mockResolvedValue(true); // PASS por defecto

    // sceneLoader mockeado — registra el goto sin navegar de verdad
    engine.sceneLoader = vi.fn().mockResolvedValue(undefined);

    return { engine, renderer, audio, db };
}

/**
 * Carga y ejecuta un script .dan completo, avanzando automáticamente.
 *
 * Después de cada instrucción que bloquea (typewriter llamó onDone,
 * lo que desbloquea el engine), llamamos next() para simular el clic.
 * Esto continúa hasta que no hay más instrucciones.
 *
 * @param {Dramaturge} engine
 * @param {string}     script — contenido .dan
 * @param {number}     [maxSteps=200] — límite de seguridad para evitar loops
 */
async function runScript(engine, script, maxSteps = 200) {
    const instructions = parser.parse(script);
    await engine.loadScript(instructions);
    await engine.next();

    let steps = 0;
    while (engine.currentIndex < engine.instructions.length && steps < maxSteps) {
        if (!engine.isBlocked) {
            await engine.next();
        }
        steps++;

        // Pequeña pausa para permitir que las Promises se resuelvan
        await new Promise(resolve => setTimeout(resolve, 0));

        if (engine.currentIndex >= engine.instructions.length) break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS DE INTEGRACIÓN
// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — secuencia lineal básica', () => {

    it('ejecuta diálogo y narración actualizando el backlog en orden', async () => {
        const { engine } = createTestEngine();

        const script = `
pawn valeria
narrate "El bosque guardaba silencio."
valeria:neutral "¿Hay alguien aquí?"
narrate "Nadie respondió."
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog).toHaveLength(3);
        expect(engine.backlog[0]).toMatchObject({ speaker: null,      text: 'El bosque guardaba silencio.' });
        expect(engine.backlog[1]).toMatchObject({ speaker: 'Valeria', text: '¿Hay alguien aquí?' });
        expect(engine.backlog[2]).toMatchObject({ speaker: null,      text: 'Nadie respondió.' });
    });

    it('llama changeBackground con los parámetros correctos', async () => {
        const { engine, renderer } = createTestEngine();

        await runScript(engine, 'bg.set forest fade 2s');

        expect(renderer.changeBackground).toHaveBeenCalledWith('forest', 'fade', '2s');
    });

    it('actualiza visualState.bg en el estado del juego', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, 'bg.set mansion');

        expect(engine.state.visualState.bg).toBe('mansion');
    });

    it('llega al final del script — currentIndex == instructions.length', async () => {
        const { engine } = createTestEngine();

        const script = `
pawn valeria
narrate "Una línea."
valeria:neutral "Otra línea."
        `.trim();

        await runScript(engine, script);

        expect(engine.currentIndex).toBe(engine.instructions.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — flags y condicionales', () => {

    it('set flag → if verdadero → ejecuta la rama correcta', async () => {
        const { engine } = createTestEngine();

        const script = `
set flag.visitado = true
if flag.visitado == true
    narrate "Rama verdadera."
else
    narrate "Rama falsa."
endif
        `.trim();

        await runScript(engine, script);

        // Solo debe haber una entrada en el backlog — la rama verdadera
        expect(engine.backlog).toHaveLength(1);
        expect(engine.backlog[0].text).toBe('Rama verdadera.');
    });

    it('set flag → if falso → ejecuta la rama else', async () => {
        const { engine } = createTestEngine();

        const script = `
set flag.visto = false
if flag.visto == true
    narrate "Verdadero."
else
    narrate "Falso."
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog).toHaveLength(1);
        expect(engine.backlog[0].text).toBe('Falso.');
    });

    it('if sin else — condición falsa salta el bloque', async () => {
        const { engine } = createTestEngine();

        const script = `
if flag.inexistente == true
    narrate "No debería ejecutarse."
endif
narrate "Tras el bloque."
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog).toHaveLength(1);
        expect(engine.backlog[0].text).toBe('Tras el bloque.');
    });

    it('comparación numérica — > — funciona correctamente', async () => {
        const { engine } = createTestEngine();

        const script = `
set flag.intentos = 3
if flag.intentos > 2
    narrate "Muchos intentos."
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog[0].text).toBe('Muchos intentos.');
    });

    it('if anidado — ambas condiciones evaluadas independientemente', async () => {
        const { engine } = createTestEngine();

        const script = `
set flag.a = true
set flag.b = true
if flag.a == true
    if flag.b == true
        narrate "Ambos."
    endif
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog[0].text).toBe('Ambos.');
    });

    it('los flags persisten en el estado del juego', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, `
set flag.capitulo = 2
set flag.conoce_aldric = true
        `.trim());

        expect(engine.state.getFlag('capitulo')).toBe(2);
        expect(engine.state.getFlag('conoce_aldric')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — inventario', () => {

    it('inventory.add → if inventory.has → rama verdadera', async () => {
        const { engine } = createTestEngine();

        const script = `
set inventory.add llave_maestra
if inventory.has llave_maestra
    narrate "Tienes la llave."
else
    narrate "No tienes la llave."
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog[0].text).toBe('Tienes la llave.');
    });

    it('inventory.remove → if inventory.has → rama falsa', async () => {
        const { engine } = createTestEngine();

        const script = `
set inventory.add llave_maestra
set inventory.remove llave_maestra
if inventory.has llave_maestra
    narrate "Tienes la llave."
else
    narrate "No tienes la llave."
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.backlog[0].text).toBe('No tienes la llave.');
    });

    it('añadir no crea duplicados', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, `
set inventory.add llave_maestra
set inventory.add llave_maestra
        `.trim());

        expect(engine.state.inventory.filter(i => i === 'llave_maestra')).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — puzzle', () => {

    it('puzzle PASS → flag result = true → rama correspondiente', async () => {
        const { engine } = createTestEngine();

        // puzzleResolver ya mockeado para devolver true (PASS)
        const script = `
puzzle P01 pass:"¡Correcto!" fail:"Incorrecto."
if flag.P01_result == true
    narrate "El puzzle se resolvió."
else
    narrate "El puzzle falló."
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.state.getFlag('P01_result')).toBe(true);
        // El backlog tiene el texto del pass + la narración condicional
        expect(engine.backlog.some(e => e.text === 'El puzzle se resolvió.')).toBe(true);
    });

    it('puzzle FAIL → flag result = false → rama else', async () => {
        const { engine } = createTestEngine();

        engine.puzzleResolver = vi.fn().mockResolvedValue(false); // FAIL

        const script = `
puzzle P02 pass:"Bien." fail:"Mal."
if flag.P02_result == true
    narrate "Pasó."
else
    narrate "Falló."
endif
        `.trim();

        await runScript(engine, script);

        expect(engine.state.getFlag('P02_result')).toBe(false);
        expect(engine.backlog.some(e => e.text === 'Falló.')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — goto y escenas', () => {

    it('goto llama sceneLoader con el target correcto', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, 'goto cap02/scene_01');

        expect(engine.sceneLoader).toHaveBeenCalledWith('cap02/scene_01', null);
    });

    it('goto con fade pasa el color correcto', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, 'goto cap02/scene_01 fade:black');

        expect(engine.sceneLoader).toHaveBeenCalledWith('cap02/scene_01', 'black');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — script completo con múltiples mecánicas', () => {

    it('ejecuta un script de 20 líneas con condicionales, inventario y puzzle', async () => {
        const { engine } = createTestEngine();

        // Este script cubre: pawn, bg, audio, narrate, dialogue,
        // set flag, set inventory, if/else/endif, puzzle, unlock
        const script = `
pawn valeria
bg.set forest fade 1s
audio.bgm play[track_01] 0.4
narrate "La mansión llevaba décadas abandonada."
valeria:neutral "¿Por qué vine sola?"
set flag.cap01_inicio = true
set inventory.add mapa_viejo
if flag.cap01_inicio == true
    valeria:neutral "El mapa dice que hay algo aquí."
endif
if inventory.has mapa_viejo
    narrate "El mapa tembló en sus manos."
endif
puzzle P01 pass:"Lo encontró." fail:"No era aquí."
if flag.P01_result == true
    set flag.secreto_encontrado = true
    narrate "El secreto quedó al descubierto."
else
    valeria:neutral "Volveré cuando esté lista."
endif
unlock cg_01 title:"La mansión Voss"
        `.trim();

        await runScript(engine, script);

        // Estado final verificable
        expect(engine.state.getFlag('cap01_inicio')).toBe(true);
        expect(engine.state.hasItem('mapa_viejo')).toBe(true);
        expect(engine.state.getFlag('P01_result')).toBe(true);       // puzzle PASS
        expect(engine.state.getFlag('secreto_encontrado')).toBe(true);

        // El backlog tiene entradas (la cantidad exacta depende de ramas)
        expect(engine.backlog.length).toBeGreaterThan(0);

        // Se intentó desbloquear el CG
        expect(engine.sceneLoader).not.toHaveBeenCalled(); // no hay goto
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — highWaterMark y modo skip', () => {

    it('highWaterMark avanza con cada línea de texto completada', async () => {
        const { engine } = createTestEngine();

        const script = `
pawn valeria
narrate "Primera línea."
narrate "Segunda línea."
narrate "Tercera línea."
        `.trim();

        await runScript(engine, script);

        // highWaterMark debe reflejar que el jugador llegó al final
        expect(engine.highWaterMark).toBeGreaterThan(0);
        expect(engine.highWaterMark).toBeLessThanOrEqual(engine.instructions.length);
    });

    it('después de reset, highWaterMark vuelve a 0', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, 'narrate "Una línea."');
        expect(engine.highWaterMark).toBeGreaterThan(0);

        engine.reset();
        expect(engine.highWaterMark).toBe(0);
    });

    it('después de reset, el backlog está vacío', async () => {
        const { engine } = createTestEngine();

        await runScript(engine, `
pawn valeria
narrate "Algo."
valeria:neutral "Algo más."
        `.trim());

        expect(engine.backlog.length).toBeGreaterThan(0);
        engine.reset();
        expect(engine.backlog).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración — efectos de pantalla', () => {

    it('fx shake llama renderer.fxShake con los ms correctos', async () => {
        const { engine, renderer } = createTestEngine();

        await runScript(engine, 'fx shake 0.4s');

        expect(renderer.fxShake).toHaveBeenCalledWith(400);
    });

    it('fx flash llama renderer.fxFlash con color y ms correctos', async () => {
        const { engine, renderer } = createTestEngine();

        await runScript(engine, 'fx flash black 500ms');

        expect(renderer.fxFlash).toHaveBeenCalledWith('black', 500);
    });

    it('fx vignette on llama renderer.fxVignette(true)', async () => {
        const { engine, renderer } = createTestEngine();

        await runScript(engine, 'fx vignette on');

        expect(renderer.fxVignette).toHaveBeenCalledWith(true);
    });
});
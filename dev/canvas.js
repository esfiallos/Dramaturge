// dev/canvas.js
// Sandbox del engine para el canvas de desarrollo.
// Lee el script de localStorage['dan_script'] y lo ejecuta.
// Emite estado al debug vía BroadcastChannel('dan-debug').

import { db }           from '../src/core/database/db.js';
import { Dramaturge }  from '../src/core/Engine.js';
import { KParser }      from '../src/core/parser/Parser.js';
import { Renderer }   from '../src/modules/Renderer.js';
import { AudioManager }      from '../src/modules/Audio.js';
import { GameState }    from '../src/core/State.js';
import { PuzzleSystem } from '../src/modules/PuzzleSystem.js';

// ─── Canal de debug ────────────────────────────────────────────────────────
const debugChannel = new BroadcastChannel('dan-debug');

function emitDebug(type, payload) {
    debugChannel.postMessage({ type, payload, ts: Date.now() });
}

// ─── Leer script ──────────────────────────────────────────────────────────
const script   = localStorage.getItem('dan_script') ?? '';
const filename = localStorage.getItem('dan_filename') ?? 'script';

document.getElementById('hud-filename').textContent = `${filename}.dan`;

if (!script.trim()) {
    document.getElementById('no-script').style.display = 'flex';
    document.getElementById('viewport').style.display = 'none';
    emitDebug('error', { message: 'No hay script en localStorage.' });
} else {
    boot();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
async function boot() {
    const renderer    = new Renderer();
    const audio       = new AudioManager();
    const parser      = new KParser();
    const state       = new GameState();
    const engine      = new Dramaturge(db, renderer, audio, state);
    const puzzleSystem = new PuzzleSystem(db, state);

    engine.puzzleResolver = (id) => puzzleSystem.open(id);

    // Click-zone avanza el engine
    document.getElementById('click-zone')
        ?.addEventListener('click', (e) => {
            if (e.target.closest('#puzzle-overlay, #canvas-hud')) return;
            engine.next();
        });

    // Space también avanza en el canvas
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space') return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        e.preventDefault();
        engine.next();
    });

    // Reset
    document.getElementById('btn-reset-canvas')
        ?.addEventListener('click', () => window.location.reload());

    // Cerrar
    document.getElementById('btn-close')
        ?.addEventListener('click', () => window.close());

    // HUD step counter — sobrescribir next() para emitir estado
    const _origNext = engine.next.bind(engine);
    engine.next = async function() {
        await _origNext();
        updateHUDStep();
        emitDebugState();
    };

    function updateHUDStep() {
        const total = engine.instructions.length;
        const cur   = engine.currentIndex;
        document.getElementById('hud-step').textContent = `${cur} / ${total}`;
    }

    function emitDebugState() {
        const inst = engine.instructions[engine.currentIndex - 1];
        emitDebug('step', {
            index:        engine.currentIndex,
            total:        engine.instructions.length,
            instruction:  inst ?? null,
            flags:        { ...engine.state.flags },
            inventory:    [...engine.state.inventory],
            isBlocked:    engine.isBlocked,
        });
    }

    // Inicializar renderer
    await renderer.init();

    // Parsear y ejecutar
    try {
        const instructions = parser.parse(script);
        emitDebug('parsed', { instructions, filename });
        await engine.loadScript(instructions);
        audio.unlock?.();
        await engine.next();
        emitDebugState();
    } catch (err) {
        console.error('[Canvas] Error:', err);
        emitDebug('error', { message: err.message });
        document.getElementById('char-text').textContent = `Error: ${err.message}`;
    }
}
// dev/canvas.js
// Sandbox del engine para el canvas de desarrollo.
// Lee el script de localStorage['vemn_script'] y lo ejecuta.
// Emite estado al debug vía BroadcastChannel('vemn-debug').

import { db }           from '../src/core/database/db.js';
import { EmersEngine }  from '../src/core/Engine.js';
import { EParser }      from '../src/core/parser/Parser.js';
import { MERenderer }   from '../src/modules/Renderer.js';
import { MEAudio }      from '../src/modules/Audio.js';
import { GameState }    from '../src/core/State.js';
import { PuzzleSystem } from '../src/modules/PuzzleSystem.js';

// ─── Canal de debug ────────────────────────────────────────────────────────
const debugChannel = new BroadcastChannel('vemn-debug');

function emitDebug(type, payload) {
    debugChannel.postMessage({ type, payload, ts: Date.now() });
}

// ─── Leer script ──────────────────────────────────────────────────────────
const script   = localStorage.getItem('vemn_script') ?? '';
const filename = localStorage.getItem('vemn_filename') ?? 'script';

document.getElementById('hud-filename').textContent = `${filename}.ems`;

if (!script.trim()) {
    document.getElementById('no-script').style.display = 'flex';
    document.getElementById('emers-viewport').style.display = 'none';
    emitDebug('error', { message: 'No hay script en localStorage.' });
} else {
    boot();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
async function boot() {
    const renderer    = new MERenderer();
    const audio       = new MEAudio();
    const parser      = new EParser();
    const state       = new GameState();
    const engine      = new EmersEngine(db, renderer, audio, state);
    const puzzleSystem = new PuzzleSystem(db, state);

    engine.puzzleResolver = (id) => puzzleSystem.open(id);

    // Click-zone avanza el engine
    document.getElementById('click-zone')
        ?.addEventListener('click', (e) => {
            if (e.target.closest('#puzzle-overlay, #canvas-hud')) return;
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
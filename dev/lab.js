// dev/lab.js
// Entry point del laboratorio de desarrollo.
// NUNCA importar este archivo desde src/main.js.

import { db }           from '../src/core/database/db.js';
import { EmersEngine }  from '../src/core/Engine.js';
import { EParser }      from '../src/core/parser/Parser.js';
import { MERenderer }   from '../src/modules/Renderer.js';
import { MEAudio }      from '../src/modules/Audio.js';
import { GameState }    from '../src/core/State.js';
import { SaveManager }  from '../src/core/SaveManager.js';
import { PuzzleSystem } from '../src/modules/PuzzleSystem.js';
import { SceneManager }      from '../src/core/SceneManager.js';
import { CharacterManager }  from './CharacterManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// SYNTAX HIGHLIGHTER
// ─────────────────────────────────────────────────────────────────────────────
//
// Orden de aplicación (más específico → más general):
//   1. Comentarios    — tapan todo, van primero
//   2. set inventory  — antes que SET (es un subconjunto de "set ...")
//   3. set flag       — después de inventory para no colisionar
//   4. actor:pose     — antes de keywords para no capturar "pawn" como actor
//   5. Strings        — comillas
//   6. VO tags        — [001]
//   7. Keywords       — pawn, show, hide, bg.set, etc.
//   8. Slots          — left, center, right
//   9. Valores tiempo — 2s, 500ms

const RE_COMMENT      = /(#.*)/g;
const RE_INV_ADD      = /\b(set)\s+(inventory\.add)\s+(\w+)/g;
const RE_INV_REMOVE   = /\b(set)\s+(inventory\.remove)\s+(\w+)/g;
const RE_SET_FLAG     = /\b(set)\s+(flag\.\w+)\s*(=)\s*(\S+)/g;
const RE_ACTOR_POSE   = /\b([a-zA-Z_]\w*):([a-zA-Z_]\w*)/g;
const RE_STRING       = /"([^"]*)"/g;
const RE_VO_TAG       = /\[(\w+)\]/g;
const RE_KEYWORDS     = /\b(pawn|show|hide|at|fade|slide|narrate|wait|goto|bg\.set|audio\.bgm|audio\.se)\b/g;
const RE_PUZZLE       = /\b(puzzle)\s+(\w+)\s+pass:/g;
const RE_SLOTS        = /\b(left|center|right)\b/g;
const RE_TIME         = /\b(\d+(?:\.\d+)?(?:s|ms))\b/g;

function highlightLine(raw) {
    let s = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const segs = [];
    const ph   = (html) => { const i = segs.length; segs.push(html); return `\x00${i}\x00`; };

    // 1. Comentarios
    s = s.replace(RE_COMMENT, (_, c) =>
        ph(`<span style="color:var(--syn-comment)">${c}</span>`)
    );

    // 2. set inventory.add / remove
    s = s.replace(RE_INV_ADD, (_, kw, op, item) =>
        ph(`<span style="color:var(--syn-keyword)">${kw}</span> ` +
           `<span style="color:var(--syn-slot)">${op}</span> ` +
           `<span style="color:var(--syn-actor)">${item}</span>`)
    );
    s = s.replace(RE_INV_REMOVE, (_, kw, op, item) =>
        ph(`<span style="color:var(--syn-keyword)">${kw}</span> ` +
           `<span style="color:var(--syn-slot)">${op}</span> ` +
           `<span style="color:var(--syn-actor)">${item}</span>`)
    );

    // 3. puzzle puzzleId pass:"..." fail:"..."
    s = s.replace(RE_PUZZLE, (_, kw, pid) =>
        ph(`<span style="color:var(--syn-keyword);font-weight:500">${kw}</span> ` +
           `<span style="color:var(--syn-vo)">${pid}</span>`)
    );

    // 4. set flag.key = value
    s = s.replace(RE_SET_FLAG, (_, kw, flag, eq, val) =>
        ph(`<span style="color:var(--syn-keyword)">${kw}</span> ` +
           `<span style="color:var(--syn-pose)">${flag}</span>` +
           `<span style="color:var(--text-dim)"> ${eq} </span>` +
           `<span style="color:var(--syn-vo)">${val}</span>`)
    );

    // 4. actor:pose
    s = s.replace(RE_ACTOR_POSE, (_, actor, pose) =>
        ph(`<span style="color:var(--syn-actor)">${actor}</span>` +
           `<span style="color:var(--text-muted)">:</span>` +
           `<span style="color:var(--syn-pose)">${pose}</span>`)
    );

    // 5. Strings
    s = s.replace(RE_STRING, (_, inner) =>
        ph(`<span style="color:var(--syn-string)">&quot;${inner}&quot;</span>`)
    );

    // 6. VO tags
    s = s.replace(RE_VO_TAG, (_, tag) =>
        ph(`<span style="color:var(--syn-vo)">[${tag}]</span>`)
    );

    // 7. Keywords
    s = s.replace(RE_KEYWORDS, (kw) =>
        ph(`<span style="color:var(--syn-keyword);font-weight:500">${kw}</span>`)
    );

    // 8. Slots
    s = s.replace(RE_SLOTS, (sl) =>
        ph(`<span style="color:var(--syn-slot)">${sl}</span>`)
    );

    // 9. Tiempo
    s = s.replace(RE_TIME, (t) =>
        ph(`<span style="color:var(--syn-time)">${t}</span>`)
    );

    return s.replace(/\x00(\d+)\x00/g, (_, i) => segs[parseInt(i)]);
}

function applyHighlight() {
    const lines = editor.value.split('\n');
    highlight.innerHTML   = lines.map(l => `<span class="hl-line">${highlightLine(l) || ' '}</span>`).join('');
    lineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
    highlight.scrollTop   = editor.scrollTop;
    highlight.scrollLeft  = editor.scrollLeft;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

function log(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString('es', { hour12: false });
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${msg}</span>`;
    logPanel.appendChild(entry);
    logPanel.scrollTop = logPanel.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE INSPECTOR — muestra el GameState vivo, no las instrucciones crudas
// ─────────────────────────────────────────────────────────────────────────────

function colorizeJSON(obj) {
    return JSON.stringify(obj, null, 2)
        .replace(/("[\w]+")\s*:/g,    '<span class="json-key">$1</span>:')
        .replace(/:\s*(".*?")/g,      ': <span class="json-str">$1</span>')
        .replace(/:\s*(\d+\.?\d*)/g,  ': <span class="json-num">$1</span>')
        .replace(/:\s*(true|false)/g, ': <span class="json-bool">$1</span>')
        .replace(/:\s*(null)/g,       ': <span class="json-null">$1</span>');
}

function updateStateInspector() {
    // Muestra el GameState del engine — la fuente de verdad del juego
    const snapshot = {
        currentIndex:  engine.currentIndex,
        isBlocked:     engine.isBlocked,
        slots:         engine.slots,
        activePawns:   [...engine.activePawns.keys()],
        // Estado de juego real
        flags:         { ...engine.state.flags },
        inventory:     [...engine.state.inventory],
        audioSettings: { ...engine.state.audioSettings },
        playTime:      engine.state.playTime,
    };
    stateEl.innerHTML = colorizeJSON(snapshot);
}

function updateInstructionBar() {
    const total   = engine.instructions.length;
    const current = Math.min(engine.currentIndex, total);
    const inst    = engine.instructions[current - 1];

    ibIdx.textContent       = `${current} / ${total}`;
    ibType.textContent      = inst?.type ?? '—';
    stepCounter.textContent = `${current} / ${total}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED DE LA BASE DE DATOS
// ─────────────────────────────────────────────────────────────────────────────

async function seedDB() {
    // Limpiar saves corruptos de sesiones anteriores del lab
    // (evita que "Continuar" en producción intente cargar un script de prueba)
    await db.saves.clear();
    await db.characters.clear();
    await db.characters.bulkPut([
        {
            id:          'valeria',
            name:        'Valeria',
            basePath:    '/assets/sprites/v/',
            voicePrefix: 'VAL_',
            poses: [
                { alias: 'neutral',  file: 'v_idle.webp'      },
                { alias: 'triste',   file: 'v_sad.webp'        },
                { alias: 'sorpresa', file: 'v_surprised.webp'  },
            ],
        },
        {
            id:          'miki',
            name:        'Miki',
            basePath:    '/assets/sprites/m/',
            voicePrefix: 'MIK_',
            poses: [
                { alias: 'neutral', file: 'm_idle.webp'  },
                { alias: 'feliz',   file: 'm_happy.webp' },
            ],
        },
    ]);
    // Seed de puzzles de prueba — cubre los 3 tipos
    await db.puzzles.clear();
    await db.puzzles.bulkPut([
        {
            puzzleId:    'P01',
            type:        'MULTIPLE_CHOICE',
            title:       'El Código del Bibliotecario',
            description: '¿Cuántos sellos tiene el sello mayor de la biblioteca antigua?',
            options:     ['Tres sellos', 'Siete sellos', 'Doce sellos'],
            answer:      1,  // "Siete sellos" — índice 1
        },
        {
            puzzleId:    'P02',
            type:        'FREE_TEXT',
            title:       'La Contraseña Olvidada',
            description: 'En el margen del diario encontraste una pista: "el nombre del primer guardián".',
            answer:      'aldric',  // comparación case-insensitive
        },
        {
            puzzleId:    'P03',
            type:        'INVENTORY',
            title:       'La Puerta Sellada',
            description: 'La puerta responde a la llave maestra.',
            requiredItem: 'llave_maestra',
        },
    ]);
    log('DB → puzzles inyectados (P01, P02, P03).', 'ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// WIRING — módulos del engine con State y SaveManager conectados
// ─────────────────────────────────────────────────────────────────────────────

const renderer    = new MERenderer();
const audio       = new MEAudio();
const parser      = new EParser();
const saveManager = new SaveManager(db);

// Engine se recrea en cada runScript(). Las referencias de módulos persisten.
let state         = new GameState();
let engine        = new EmersEngine(db, renderer, audio, state, saveManager);

// PuzzleSystem se recrea junto al engine para tener el state actualizado.
// La referencia se actualiza en runScript() y resetLab().
let puzzleSystem  = new PuzzleSystem(db, state);
engine.puzzleResolver = (id) => puzzleSystem.open(id);

// En el lab no hay archivos .ems reales que fetchear.
// SceneManager existe para que el GOTO no quede sin resolver,
// pero al llegar a goto el engine ya se detuvo en el último step del script de prueba.
// En producción el SceneManager fetchearía /public/scripts/cap01/scene_02.ems.
let sceneManager  = new SceneManager(engine, parser, '/scripts/');
engine.sceneLoader = (target) => sceneManager.goto(target);

// ─────────────────────────────────────────────────────────────────────────────
// REFS DOM
// ─────────────────────────────────────────────────────────────────────────────

const editor      = document.getElementById('ems-editor');
const highlight   = document.getElementById('ems-highlight');
const lineNumbers = document.getElementById('line-numbers');
const logPanel    = document.getElementById('debug-log');
const stateEl     = document.getElementById('state-inspector');
const ibType      = document.getElementById('ib-type');
const ibIdx       = document.getElementById('ib-idx');
const stepCounter = document.getElementById('step-counter');
const editorDot   = document.getElementById('editor-dot');
const viewportDot = document.getElementById('viewport-dot');

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT DE PRUEBA — ejercita todos los comandos implementados
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SCRIPT = `# Test completo — Gramática EMS completa
# Cubre: PAWN_LOAD, BG_CHANGE, SPRITE_SHOW, DIALOGUE, NARRATE,
#        WAIT, PUZZLE, GOTO, SET_FLAG, INVENTORY_ADD, INVENTORY_REMOVE, SPRITE_HIDE

pawn valeria, miki

bg.set forest fade:2s

# --- Narración de apertura (full-screen, sin personaje) ---
narrate "El tiempo se detuvo en el umbral de la biblioteca."

# --- Pausa dramática antes de mostrar los personajes ---
wait 1.5s

show valeria:neutral at left fade

valeria:triste "No puedo creer que estemos aquí de nuevo." [001]
valeria:neutral "Pensé que todo había terminado."

# --- Lógica de estado ---
set flag.conociste_a_miki = true
set flag.capitulo = 1
set inventory.add diario_viejo

# --- Puzzle: el escritor solo invoca, el resultado maneja los textos ---
puzzle P01 pass:"Encontraste la clave oculta en las páginas." fail:"El código era incorrecto. La puerta no cede."

# --- Segundo personaje entra después del puzzle ---
show miki:feliz at right slide
miki:feliz "¡Oye! Yo tampoco esperaba verte tan pronto."

valeria:sorpresa "¿Miki? ¿Qué haces aquí?"

# --- Más estado ---
set flag.miki_presente = true
set inventory.add llave_maestra
set inventory.remove diario_viejo

# --- Salida de escena ---
hide valeria fade
miki:neutral "Supongo que tendré que explicarlo todo."

# --- Salto de escena (loguea el destino, carga pendiente en Step 7) ---
goto capitulo_02
`;

// ─────────────────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER MANAGER
// ─────────────────────────────────────────────────────────────────────────────

let charManager;

function initCharManager() {
    const panel = document.getElementById('char-panel');
    if (!panel) return;
    charManager = new CharacterManager(db);
    charManager.mount(panel);
}

// Exponer logAll() en consola para consulta rápida en cualquier momento:
//   charManager.logAll()   ← desde la consola del navegador
window.addEventListener('load', () => {
    window.__vemn = window.__vemn ?? {};
    window.__vemn.logChars = () => charManager?.logAll();
    console.log('[Lab] Tip: usa __vemn.logChars() para ver todos los personajes en consola.');
});

// ─────────────────────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

function initTabs() {
    document.querySelectorAll('.lab-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            document.querySelectorAll('.lab-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.lab-tab-pane').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`lab-tab-${target}`)?.classList.add('active');

            // Refrescar la lista de personajes cada vez que se abre el tab
            if (target === 'chars') charManager?.mount(document.getElementById('char-panel'));
        });
    });
}

async function boot() {
    await renderer.init();
    viewportDot.classList.add('active');
    log('Renderer (PixiJS v8) montado.', 'ok');

    await seedDB();

    editor.value = DEFAULT_SCRIPT;
    applyHighlight();
    editorDot.style.background = 'var(--gold)';

    // Mostrar estado inicial vacío en el inspector
    updateStateInspector();

    log('Lab listo. Presiona ▶ Run para compilar.', 'ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// EJECUTAR SCRIPT
// ─────────────────────────────────────────────────────────────────────────────

let _isRunning = false;

async function runScript() {
    if (_isRunning) return; // guarda contra doble ejecución
    const raw = editor.value.trim();
    if (!raw) { log('El editor está vacío.', 'warn'); return; }

    _isRunning = true;
    document.getElementById('btn-run').disabled = true;

    // Nuevo state y engine en cada Run — pizarra limpia
    state        = new GameState();
    engine       = new EmersEngine(db, renderer, audio, state, saveManager);
    puzzleSystem = new PuzzleSystem(db, state);
    engine.puzzleResolver = (id) => puzzleSystem.open(id);
    sceneManager = new SceneManager(engine, parser, '/scripts/');
    engine.sceneLoader = (target) => sceneManager.goto(target);

    log('─── Compilando script ───', 'info');

    let instructions;
    try {
        instructions = parser.parse(raw);
    } catch (err) {
        log(`Parser error: ${err.message}`, 'error');
        _isRunning = false;
        document.getElementById('btn-run').disabled = false;
        return;
    }

    // Reporte de compilación
    const byType = instructions.reduce((acc, i) => {
        acc[i.type] = (acc[i.type] ?? 0) + 1;
        return acc;
    }, {});

    log(`Parser → ${instructions.length} instrucciones:`, 'ok');
    Object.entries(byType).forEach(([type, count]) => {
        const isUnknown = type === 'UNKNOWN';
        log(`  ${isUnknown ? '⚠' : '·'} ${type}: ${count}`, isUnknown ? 'warn' : 'info');
    });

    // Advertir sobre instrucciones no reconocidas
    instructions.filter(i => i.type === 'UNKNOWN')
        .forEach(u => log(`  Línea ${u.line + 1}: "${u.raw}"`, 'warn'));

    await engine.loadScript(instructions);
    updateStateInspector();
    updateInstructionBar();

    log('Engine listo. Haz clic en el viewport para avanzar.', 'ok');
    viewportDot.classList.add('active');

    _isRunning = false;
    document.getElementById('btn-run').disabled = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────────────────────────

function resetLab() {
    state        = new GameState();
    engine       = new EmersEngine(db, renderer, audio, state, saveManager);
    puzzleSystem = new PuzzleSystem(db, state);
    engine.puzzleResolver = (id) => puzzleSystem.open(id);
    sceneManager = new SceneManager(engine, parser, '/scripts/');
    engine.sceneLoader = (target) => sceneManager.goto(target);

    renderer.bgLayer?.removeChildren();
    renderer.spriteLayer?.removeChildren();
    renderer.bgCurrent = null;
    renderer.activeSprites?.clear();

    document.getElementById('char-name').innerText = 'Sistema';
    document.getElementById('char-text').innerText = 'Presiona ▶ Run para compilar y ejecutar el script.';
    document.getElementById('text-box').classList.remove('narration-mode');

    logPanel.innerHTML = '';
    stateEl.innerHTML  = '';
    ibType.textContent = '—';
    ibIdx.textContent  = '0 / 0';
    stepCounter.textContent = '— / —';

    updateStateInspector();
    log('Lab reseteado.', 'ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

editor.addEventListener('input', applyHighlight);

editor.addEventListener('scroll', () => {
    highlight.scrollTop  = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
});

editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end   = editor.selectionEnd;
        editor.value = editor.value.slice(0, start) + '    ' + editor.value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
        applyHighlight();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runScript();
    }
});

document.getElementById('btn-run').addEventListener('click', runScript);
document.getElementById('btn-reset').addEventListener('click', resetLab);

document.getElementById('click-zone').addEventListener('click', async () => {
    await engine.next();
    updateInstructionBar();
    updateStateInspector();
});

// ─────────────────────────────────────────────────────────────────────────────
boot();
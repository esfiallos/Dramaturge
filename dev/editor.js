// dev/editor.js
// Lógica del editor de scripts .ems
// Comunicación con canvas: localStorage['vemn_script'] + localStorage['vemn_filename']

import { EParser } from '../src/core/parser/Parser.js';

const parser   = new EParser();

const editorEl   = document.getElementById('ems-editor');
const highlightEl= document.getElementById('ems-highlight');
const lineNumEl  = document.getElementById('line-numbers');
const filenameEl = document.getElementById('filename');
const statusPos  = document.getElementById('status-pos');
const statusCount= document.getElementById('status-count');
const savedBadge = document.getElementById('saved-badge');

// ─── Constantes de sintaxis ────────────────────────────────────────────────

const RULES = [
    // Comentarios — primero, tapan todo
    [/(#.*)/g,
        (_, c) => `<span class="syn-comment">${c}</span>`],

    // set inventory.add / remove
    [/\b(set)\s+(inventory\.add|inventory\.remove)\s+(\w+)/g,
        (_, k, op, item) => `<span class="syn-keyword">${k}</span> <span class="syn-slot">${op}</span> <span class="syn-actor">${item}</span>`],

    // set flag.key = value
    [/\b(set)\s+(flag\.\w+)\s*(=)\s*(\S+)/g,
        (_, k, f, eq, v) => `<span class="syn-keyword">${k}</span> <span class="syn-flag">${f}</span><span class="syn-op"> ${eq} </span><span class="syn-bool">${v}</span>`],

    // puzzle id pass:... fail:...
    [/\b(puzzle)\s+(\w+)/g,
        (_, k, id) => `<span class="syn-keyword">${k}</span> <span class="syn-vo">${id}</span>`],

    // Condicionales if / else / endif + inventory.has
    [/\b(if|else|endif|inventory\.has)\b/g,
        (_, k) => `<span class="syn-cond">${k}</span>`],

    // Operadores de comparación
    [/\s(==|!=|>=|<=|>|<)\s/g,
        (m) => `<span class="syn-op">${m}</span>`],

    // actor:pose
    [/\b([a-zA-Z_]\w*):([a-zA-Z_]\w*)/g,
        (_, a, p) => `<span class="syn-actor">${a}</span><span class="syn-op">:</span><span class="syn-pose">${p}</span>`],

    // Strings entre comillas
    [/"([^"]*)"/g,
        (_, s) => `<span class="syn-string">"${s}"</span>`],

    // Voice tags [001]
    [/\[(\w+)\]/g,
        (_, v) => `[<span class="syn-vo">${v}</span>]`],

    // Keywords principales
    [/\b(pawn|show|hide|at|fade|slide|narrate|wait|goto|bg\.set|audio\.bgm|audio\.se)\b/g,
        (_, k) => `<span class="syn-keyword">${k}</span>`],

    // Slots
    [/\b(left|center|right)\b/g,
        (_, s) => `<span class="syn-slot">${s}</span>`],

    // Tiempos
    [/\b(\d+(?:\.\d+)?(?:s|ms))\b/g,
        (_, t) => `<span class="syn-time">${t}</span>`],

    // true / false
    [/\b(true|false)\b/g,
        (_, b) => `<span class="syn-bool">${b}</span>`],
];

function escape(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightLine(raw) {
    if (!raw.trim()) return ' ';
    let s = escape(raw);

    // Placeholders para proteger spans ya procesados
    const segs = [];
    const ph   = (html) => { const i = segs.length; segs.push(html); return `\x00${i}\x00`; };

    for (const [re, fn] of RULES) {
        s = s.replace(re, (...args) => ph(fn(...args)));
    }

    // Restaurar placeholders
    return s.replace(/\x00(\d+)\x00/g, (_, i) => segs[Number(i)]);
}

// ─── Render ───────────────────────────────────────────────────────────────

let _parseTimeout = null;

function render() {
    const text  = editorEl.value;
    const lines = text.split('\n');

    // Highlight
    highlightEl.innerHTML = lines
        .map(l => `<span class="hl-line">${highlightLine(l)}</span>`)
        .join('');

    // Line numbers
    lineNumEl.innerHTML = lines
        .map((_, i) => `<div>${i + 1}</div>`)
        .join('');

    // Sync scroll
    highlightEl.scrollTop  = editorEl.scrollTop;
    highlightEl.scrollLeft = editorEl.scrollLeft;

    // Debounced parse count
    clearTimeout(_parseTimeout);
    _parseTimeout = setTimeout(() => {
        try {
            const inst = parser.parse(text);
            const real = inst.filter(i => i.type !== 'UNKNOWN').length;
            statusCount.textContent = `${real} instrucciones`;
        } catch { statusCount.textContent = 'Error de parseo'; }
    }, 400);

    // Persist to localStorage for canvas
    localStorage.setItem('vemn_script', text);
    localStorage.setItem('vemn_filename', filenameEl.value || 'script');
}

// ─── Cursor position ──────────────────────────────────────────────────────

function updateCursor() {
    const pos   = editorEl.selectionStart;
    const text  = editorEl.value.slice(0, pos);
    const lines = text.split('\n');
    statusPos.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

// ─── Tab key support ──────────────────────────────────────────────────────

editorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = editorEl.selectionStart;
        const end   = editorEl.selectionEnd;
        editorEl.value = editorEl.value.slice(0, start) + '    ' + editorEl.value.slice(end);
        editorEl.selectionStart = editorEl.selectionEnd = start + 4;
        render();
    }
});

// ─── Events ───────────────────────────────────────────────────────────────

editorEl.addEventListener('input',   render);
editorEl.addEventListener('scroll',  () => {
    highlightEl.scrollTop  = editorEl.scrollTop;
    highlightEl.scrollLeft = editorEl.scrollLeft;
    lineNumEl.scrollTop    = editorEl.scrollTop;
});
editorEl.addEventListener('keyup',   updateCursor);
editorEl.addEventListener('click',   updateCursor);

// ─── Save to file ─────────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', () => {
    const name    = (filenameEl.value || 'script').replace(/\.ems$/, '');
    const blob    = new Blob([editorEl.value], { type: 'text/plain' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `${name}.ems`;
    a.click();
    URL.revokeObjectURL(url);

    savedBadge.classList.add('show');
    setTimeout(() => savedBadge.classList.remove('show'), 1800);
});

// ─── Load from file ───────────────────────────────────────────────────────

document.getElementById('load-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        editorEl.value = ev.target.result;
        // Update filename from loaded file
        filenameEl.value = file.name.replace(/\.ems$/, '');
        render();
    };
    reader.readAsText(file);
    // Reset so the same file can be re-loaded
    e.target.value = '';
});

// ─── Run → open canvas in new tab ─────────────────────────────────────────

document.getElementById('btn-run').addEventListener('click', () => {
    // Persist latest state before opening
    localStorage.setItem('vemn_script', editorEl.value);
    localStorage.setItem('vemn_filename', filenameEl.value || 'script');
    window.open('/dev/canvas.html', 'vemn-canvas');
});

// ─── Restore from localStorage ────────────────────────────────────────────

const saved = localStorage.getItem('vemn_script');
if (saved) {
    editorEl.value = saved;
    filenameEl.value = localStorage.getItem('vemn_filename') || 'script';
}

render();
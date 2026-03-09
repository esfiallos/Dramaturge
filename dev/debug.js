// dev/debug.js
// Recibe eventos del canvas vía BroadcastChannel y actualiza las 3 columnas.

const instList   = document.getElementById('inst-list');
const stateView  = document.getElementById('state-view');
const eventLog   = document.getElementById('event-log');
const instCount  = document.getElementById('inst-count');
const connBadge  = document.getElementById('connection-badge');

let allInstructions = [];
let currentIndex    = 0;
let connected       = false;

// ─── BroadcastChannel ─────────────────────────────────────────────────────
const ch = new BroadcastChannel('vemn-debug');

ch.addEventListener('message', (e) => {
    const { type, payload, ts } = e.data;

    if (!connected) {
        connected = true;
        connBadge.textContent = 'En vivo';
        connBadge.className   = 'badge-live';
        eventLog.innerHTML    = '';
    }

    switch (type) {
        case 'parsed':
            allInstructions = payload.instructions;
            renderInstructions();
            addLog('parsed', `Script parseado: ${allInstructions.length} instrucciones`, ts);
            break;

        case 'step':
            currentIndex = payload.index;
            highlightCurrentInstruction();
            renderState(payload);
            addLog('step', formatStepLog(payload), ts);
            break;

        case 'error':
            addLog('error', payload.message, ts);
            break;
    }
});

// ─── Instrucciones ────────────────────────────────────────────────────────
const TYPE_CLASS = {
    DIALOGUE:         't-dialogue',
    NARRATE:          't-narrate',
    PAWN_LOAD:        't-pawn_load',
    SPRITE_SHOW:      't-sprite_show',
    SPRITE_HIDE:      't-sprite_hide',
    BG_CHANGE:        't-bg_change',
    AUDIO:            't-audio',
    COND_JUMP:        't-cond_jump',
    JUMP:             't-jump',
    PUZZLE:           't-puzzle',
    GOTO:             't-goto',
    SET_FLAG:         't-set_flag',
    INVENTORY_ADD:    't-inventory_add',
    INVENTORY_REMOVE:'t-inventory_remove',
    WAIT:             't-wait',
};

function renderInstructions() {
    instCount.textContent = `${allInstructions.length} inst.`;
    instList.innerHTML = allInstructions.map((inst, i) => {
        const typeClass = TYPE_CLASS[inst.type] ?? '';
        const data      = formatInstData(inst);
        return `
            <div class="inst-row ${i === currentIndex - 1 ? 'active' : ''}" data-idx="${i}">
                <span class="inst-idx">${i}</span>
                <span class="inst-type ${typeClass}">${inst.type}</span>
                <span class="inst-data">${data}</span>
            </div>
        `;
    }).join('');
}

function highlightCurrentInstruction() {
    instList.querySelectorAll('.inst-row').forEach((row, i) => {
        row.classList.toggle('active', i === currentIndex - 1);
    });
    // Auto-scroll to active row
    const active = instList.querySelector('.inst-row.active');
    active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function formatInstData(inst) {
    switch (inst.type) {
        case 'DIALOGUE':      return `${inst.actor}:${inst.pose} "${truncate(inst.text, 35)}"`;
        case 'NARRATE':       return `"${truncate(inst.text, 40)}"`;
        case 'PAWN_LOAD':     return inst.names?.join(', ');
        case 'SPRITE_SHOW':   return `${inst.actor}:${inst.pose} @ ${inst.slot}`;
        case 'SPRITE_HIDE':   return inst.actor;
        case 'BG_CHANGE':     return inst.target;
        case 'AUDIO':         return `${inst.audioType} → ${inst.param}`;
        case 'COND_JUMP':     return formatCondition(inst.condition) + ` → [${inst.targetIndex}]`;
        case 'JUMP':          return `→ [${inst.targetIndex}]`;
        case 'PUZZLE':        return inst.puzzleId;
        case 'GOTO':          return inst.target;
        case 'SET_FLAG':      return `${inst.key} = ${inst.value}`;
        case 'INVENTORY_ADD': return `+ ${inst.item}`;
        case 'INVENTORY_REMOVE': return `- ${inst.item}`;
        case 'WAIT':          return inst.duration;
        default:              return '';
    }
}

function formatCondition(cond) {
    if (!cond) return '?';
    if (cond.type === 'IF_INVENTORY') return `inventory.has ${cond.item}`;
    return `flag.${cond.key} ${cond.op} ${cond.value}`;
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
}

// ─── Estado ───────────────────────────────────────────────────────────────
function renderState(payload) {
    const { flags, inventory, isBlocked, index, total } = payload;

    const flagEntries = Object.entries(flags ?? {});
    const flagsHTML   = flagEntries.length === 0
        ? '<div class="state-empty">Sin flags</div>'
        : flagEntries.map(([k, v]) =>
            `<div class="state-row">
                <span class="state-key">flag.${k}</span>
                <span class="state-value">${v}</span>
             </div>`
          ).join('');

    const inv     = inventory ?? [];
    const invHTML = inv.length === 0
        ? '<div class="state-empty">Inventario vacío</div>'
        : inv.map(i => `<span class="inv-tag">${i}</span>`).join('');

    stateView.innerHTML = `
        <div class="state-section">
            <div class="state-label">Progreso</div>
            <div class="state-row">
                <span class="state-key">instrucción</span>
                <span class="state-value">${index} / ${total}</span>
            </div>
            <div class="state-row">
                <span class="state-key">bloqueado</span>
                <span class="state-value" style="color:${isBlocked ? 'var(--yellow)' : 'var(--green)'}">${isBlocked}</span>
            </div>
        </div>
        <div class="state-section">
            <div class="state-label">Flags</div>
            ${flagsHTML}
        </div>
        <div class="state-section">
            <div class="state-label">Inventario</div>
            <div style="padding:0.25rem 0.5rem">${invHTML}</div>
        </div>
    `;
}

// ─── Log de eventos ───────────────────────────────────────────────────────
function addLog(type, message, ts) {
    const wasEmpty = eventLog.querySelector('.no-signal');
    if (wasEmpty) eventLog.innerHTML = '';

    const time = new Date(ts).toLocaleTimeString('es', { hour12: false });
    const div  = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerHTML = `<span class="log-time">${time}</span><span class="log-label">${type.toUpperCase()}</span><span class="log-msg">${message}</span>`;
    eventLog.appendChild(div);
    eventLog.scrollTop = eventLog.scrollHeight;
}

function formatStepLog(payload) {
    const inst = payload.instruction;
    if (!inst) return `Índice ${payload.index}`;
    return `[${payload.index - 1}] ${inst.type} ${formatInstData(inst)}`;
}

document.getElementById('clear-log').addEventListener('click', () => {
    eventLog.innerHTML = '<div class="no-signal"><span>Log limpiado</span></div>';
});

// ─── Cargar instrucciones del último script si existen ───────────────────
// Permite abrir debug.html antes del canvas y ver el script parseado
const savedScript = localStorage.getItem('vemn_script');
if (savedScript) {
    import('./editor.js').catch(() => {});
    // Solo parsear sin ejecutar para preview
    import('../src/core/parser/Parser.js').then(({ EParser }) => {
        try {
            const parser = new EParser();
            allInstructions = parser.parse(savedScript);
            renderInstructions();
            instCount.textContent = `${allInstructions.length} inst. (sin canvas)`;
        } catch { /* silencioso */ }
    });
}
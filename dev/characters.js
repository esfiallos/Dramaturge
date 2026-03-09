// dev/characters.js
// CRUD de personajes para /dev/characters.html

import { db } from '../src/core/database/db.js';

// ─── Estado ───────────────────────────────────────────────────────────────
let editingId = null; // null = creando, string = editando

// ─── DOM ──────────────────────────────────────────────────────────────────
const charList    = document.getElementById('char-list');
const charCount   = document.getElementById('char-count');
const formPanel   = document.getElementById('form-panel');
const formTitle   = document.getElementById('form-title');
const formError   = document.getElementById('form-error');
const fId         = document.getElementById('f-id');
const fName       = document.getElementById('f-name');
const fBasepath   = document.getElementById('f-basepath');
const fVoice      = document.getElementById('f-voice');
const fPoses      = document.getElementById('f-poses');

// ─── Render lista ─────────────────────────────────────────────────────────
async function renderList() {
    const chars = await db.characters.toArray();
    charCount.textContent = `${chars.length} personaje${chars.length !== 1 ? 's' : ''}`;

    if (chars.length === 0) {
        charList.innerHTML = `<div class="empty-state">No hay personajes. Crea el primero.</div>`;
        return;
    }

    charList.innerHTML = chars.map(c => renderCard(c)).join('');

    chars.forEach(c => {
        document.getElementById(`edit-${c.id}`)
            ?.addEventListener('click', () => openForm(c));
        document.getElementById(`delete-${c.id}`)
            ?.addEventListener('click', () => showConfirm(c));
    });
}

function renderCard(c) {
    const poses = c.poses.length === 0
        ? `<span class="no-poses">Sin poses definidas</span>`
        : c.poses.map(p =>
            `<span class="pose-tag">
                <span class="pose-alias">${p.alias}</span>
                <span class="pose-file">→ ${p.file}</span>
             </span>`
          ).join('');

    return `
        <div class="char-card" id="card-${c.id}">
            <div class="card-header">
                <div class="card-identity">
                    <span class="char-name">${c.name}</span>
                    <span class="char-id">${c.id}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-outline btn-sm" id="edit-${c.id}">Editar</button>
                    <button class="btn btn-danger btn-sm" id="delete-${c.id}">Eliminar</button>
                </div>
            </div>
            <div class="card-meta">
                <div class="meta-item">
                    <span class="meta-label">basePath</span>
                    <span>${c.basePath}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">voicePrefix</span>
                    <span>${c.voicePrefix || '—'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">poses</span>
                    <span>${c.poses.length}</span>
                </div>
            </div>
            <div class="card-poses">${poses}</div>
        </div>
    `;
}

// ─── Confirm delete inline ────────────────────────────────────────────────
function showConfirm(c) {
    const card = document.getElementById(`card-${c.id}`);
    if (!card) return;

    const bar = document.createElement('div');
    bar.className = 'confirm-bar';
    bar.innerHTML = `
        <span>¿Eliminar <strong>${c.name}</strong>? No se puede deshacer.</span>
        <div class="confirm-actions">
            <button class="btn btn-danger btn-sm" id="yes-${c.id}">Eliminar</button>
            <button class="btn btn-outline btn-sm" id="no-${c.id}">Cancelar</button>
        </div>
    `;
    card.appendChild(bar);

    document.getElementById(`yes-${c.id}`)?.addEventListener('click', async () => {
        await db.characters.delete(c.id);
        renderList();
    });
    document.getElementById(`no-${c.id}`)?.addEventListener('click', () => bar.remove());
}

// ─── Form modal ───────────────────────────────────────────────────────────
function openForm(character = null) {
    editingId = character?.id ?? null;
    formTitle.textContent = character ? `Editando: ${character.name}` : 'Nuevo personaje';
    formError.textContent = '';

    fId.value       = character?.id       ?? '';
    fName.value     = character?.name     ?? '';
    fBasepath.value = character?.basePath ?? '';
    fVoice.value    = character?.voicePrefix ?? '';
    fPoses.value    = (character?.poses ?? [])
        .map(p => `${p.alias}: ${p.file}`)
        .join('\n');

    fId.disabled = !!character; // el id no se puede cambiar al editar
    formPanel.classList.add('open');
    (character ? fName : fId).focus();
}

function closeForm() {
    formPanel.classList.remove('open');
    editingId = null;
    formError.textContent = '';
}

function showError(msg) { formError.textContent = msg; }

async function saveForm() {
    formError.textContent = '';

    const id          = fId.value.trim();
    const name        = fName.value.trim();
    const basePath    = fBasepath.value.trim();
    const voicePrefix = fVoice.value.trim();
    const posesRaw    = fPoses.value.trim();

    if (!id)       return showError('El ID es obligatorio.');
    if (!name)     return showError('El nombre es obligatorio.');
    if (!basePath) return showError('El basePath es obligatorio.');
    if (!/^\w+$/.test(id))          return showError('El ID solo puede tener letras, números y _');
    if (!basePath.startsWith('/'))  return showError('basePath debe empezar con /');
    if (!basePath.endsWith('/'))    return showError('basePath debe terminar con /');

    // Parsear poses
    const poses = [];
    if (posesRaw) {
        for (const line of posesRaw.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            const colon = t.indexOf(':');
            if (colon === -1) return showError(`Pose con formato incorrecto: "${t}" — usar "alias: archivo"`);
            const alias = t.slice(0, colon).trim();
            const file  = t.slice(colon + 1).trim();
            if (!alias || !file) return showError(`Pose incompleta: "${t}"`);
            poses.push({ alias, file });
        }
    }

    // Verificar duplicado solo en creación
    if (!editingId) {
        const existing = await db.characters.get(id);
        if (existing) return showError(`Ya existe un personaje con id "${id}".`);
    }

    await db.characters.put({ id, name, basePath, voicePrefix, poses });
    console.log(`[Characters] ${editingId ? 'Actualizado' : 'Creado'}: ${id}`);
    closeForm();
    renderList();
}

// ─── Log en consola ───────────────────────────────────────────────────────
async function logAll() {
    const chars = await db.characters.toArray();
    if (chars.length === 0) {
        console.log('[Dramaturge] No hay personajes en la DB.');
        return;
    }
    console.group(`[Dramaturge] ${chars.length} personaje(s):`);
    chars.forEach(c => {
        console.group(`  ▸ ${c.name} (${c.id})`);
        console.log(`    basePath:    ${c.basePath}`);
        console.log(`    voicePrefix: ${c.voicePrefix || '—'}`);
        console.log(`    poses (${c.poses.length}):`);
        c.poses.forEach(p => console.log(`      · ${p.alias} → ${p.file}`));
        console.groupEnd();
    });
    console.groupEnd();
}

// Exponer en consola: __dramaturge.logChars()
window.__dramaturge = window.__dramaturge ?? {};
window.__dramaturge.logChars = logAll;
console.log('[Dramaturge] Tip: __dramaturge.logChars() para ver todos los personajes en consola.');

// ─── Eventos ──────────────────────────────────────────────────────────────
document.getElementById('btn-new')?.addEventListener('click', () => openForm());
document.getElementById('btn-log-all')?.addEventListener('click', logAll);
document.getElementById('btn-form-close')?.addEventListener('click', closeForm);
document.getElementById('btn-form-cancel')?.addEventListener('click', closeForm);
document.getElementById('btn-form-save')?.addEventListener('click', saveForm);

// Cerrar con ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && formPanel.classList.contains('open')) closeForm();
});

// ─── Init ─────────────────────────────────────────────────────────────────
renderList();
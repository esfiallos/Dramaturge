// dev/characters.js
// Panel de gestión de personajes — lee y escribe directamente a DramaturgeDB.
// Incluye: formulario con derivación automática, poses dinámicas, export seed.js

import { db } from '../src/core/database/db.js';

// ─── Estado ───────────────────────────────────────────────────────────────────
let editingId = null; // null = creación, string = edición

// ─── Elementos ────────────────────────────────────────────────────────────────
const charList      = document.getElementById('char-list');
const charCount     = document.getElementById('char-count');
const formPanel     = document.getElementById('form-panel');
const formTitle     = document.getElementById('form-title');
const formError     = document.getElementById('form-error');
const posesList     = document.getElementById('poses-list');
const exportModal   = document.getElementById('export-modal');
const exportCode    = document.getElementById('export-code');

const fId       = document.getElementById('f-id');
const fName     = document.getElementById('f-name');
const fBasepath = document.getElementById('f-basepath');
const fVoice    = document.getElementById('f-voice');

// ─── Lista de personajes ──────────────────────────────────────────────────────

async function renderList() {
    const chars = await db.characters.toArray();
    charCount.textContent = `${chars.length} personaje${chars.length !== 1 ? 's' : ''}`;

    if (chars.length === 0) {
        charList.innerHTML = `<div class="empty-state">Sin personajes · Crea el primero con el botón de arriba</div>`;
        return;
    }

    charList.innerHTML = chars.map(c => `
        <div class="char-card" id="card-${c.id}">
            <div class="card-header">
                <div class="card-identity">
                    <span class="char-name">${c.name}</span>
                    <span class="char-id">${c.id}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-outline btn-sm" data-edit="${c.id}">Editar</button>
                    <button class="btn btn-danger btn-sm" data-delete="${c.id}" data-name="${c.name}">Eliminar</button>
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
                    <span>${c.poses?.filter(p => p.alias).length ?? 0}</span>
                </div>
            </div>
            <div class="card-poses">
                ${c.poses?.filter(p => p.alias).length
                    ? c.poses.filter(p => p.alias).map(p => `
                        <div class="pose-tag">
                            <span class="pose-alias">${p.alias}</span>
                            <span class="pose-file">${p.file}</span>
                        </div>`).join('')
                    : '<span class="no-poses">Sin poses registradas</span>'
                }
            </div>
        </div>
    `).join('');

    // Eventos en tarjetas
    charList.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const c = await db.characters.get(btn.dataset.edit);
            if (c) openForm(c);
        });
    });

    charList.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => showConfirm(btn.dataset.delete, btn.dataset.name));
    });
}

function showConfirm(id, name) {
    // Quitar confirmación anterior si la hay
    document.querySelectorAll('.confirm-bar').forEach(b => b.remove());

    const card = document.getElementById(`card-${id}`);
    const bar  = document.createElement('div');
    bar.className = 'confirm-bar';
    bar.innerHTML = `
        <span>¿Eliminar <strong>${name}</strong>? No se puede deshacer.</span>
        <div class="confirm-actions">
            <button class="btn btn-outline btn-sm" id="no-${id}">Cancelar</button>
            <button class="btn btn-danger btn-sm" id="yes-${id}">Eliminar</button>
        </div>`;
    card.appendChild(bar);

    document.getElementById(`yes-${id}`)?.addEventListener('click', async () => {
        await db.characters.delete(id);
        await renderList();
    });
    document.getElementById(`no-${id}`)?.addEventListener('click', () => bar.remove());
}

// ─── Formulario ───────────────────────────────────────────────────────────────

function openForm(character = null) {
    editingId = character?.id ?? null;
    formTitle.textContent = character ? `Editando: ${character.name}` : 'Nuevo personaje';
    formError.textContent = '';

    fId.value       = character?.id ?? '';
    fName.value     = character?.name ?? '';
    fBasepath.value = character?.basePath ?? '';
    fVoice.value    = character?.voicePrefix ?? '';

    // Si es edición, ID no editable
    fId.disabled = !!character;

    // Desactivar derivación automática si hay valores ya establecidos
    fBasepath.classList.toggle('auto-derived', !character);
    fVoice.classList.toggle('auto-derived', !character);

    // Construir filas de poses
    buildPoseRows(character?.poses?.filter(p => p.alias) ?? []);

    formPanel.classList.add('open');
    fId.focus();
}

function closeForm() {
    formPanel.classList.remove('open');
    editingId = null;
    fId.disabled = false;
}

// ── Derivación automática de basePath y voicePrefix a partir del ID ──────────
fId.addEventListener('input', () => {
    const id = fId.value.trim().toLowerCase();
    if (!id || editingId) return;

    // Solo derivar si el campo no ha sido tocado manualmente
    if (fBasepath.classList.contains('auto-derived')) {
        fBasepath.value = id ? `/assets/sprites/${id}/` : '';
    }
    if (fVoice.classList.contains('auto-derived')) {
        // Prefijo = primeras 3 letras en mayúsculas + guión bajo
        const prefix = id.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase();
        fVoice.value = prefix ? `${prefix}_` : '';
    }
});

// Marcar como "editado manualmente" cuando el usuario toca los campos derivados
fBasepath.addEventListener('input', () => fBasepath.classList.remove('auto-derived'));
fVoice.addEventListener('input',    () => fVoice.classList.remove('auto-derived'));

// ── Poses dinámicas ───────────────────────────────────────────────────────────

function buildPoseRows(poses = []) {
    posesList.innerHTML = '';
    if (poses.length === 0) {
        addPoseRow();  // siempre al menos una fila vacía
    } else {
        poses.forEach(p => addPoseRow(p.alias, p.file));
    }
}

function addPoseRow(alias = '', file = '') {
    const row = document.createElement('div');
    row.className = 'pose-row';
    row.innerHTML = `
        <input class="pose-input alias" type="text" placeholder="neutral" value="${alias}"
               autocomplete="off" spellcheck="false">
        <input class="pose-input file"  type="text" placeholder="neutral.webp" value="${file}"
               autocomplete="off" spellcheck="false">
        <button class="pose-del" title="Eliminar pose">✕</button>`;

    // Autocompletar extensión en archivo si alias tiene valor y archivo está vacío
    const aliasInput = row.querySelector('.alias');
    const fileInput  = row.querySelector('.file');

    aliasInput.addEventListener('blur', () => {
        if (!fileInput.value && aliasInput.value.trim()) {
            fileInput.value = `${aliasInput.value.trim()}.webp`;
        }
    });

    // Tab desde alias va directo a archivo
    aliasInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            fileInput.focus();
        }
    });

    // Enter en archivo añade nueva fila
    fileInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPoseRow();
            // Foco en el alias de la nueva fila
            const rows = posesList.querySelectorAll('.pose-row');
            rows[rows.length - 1].querySelector('.alias').focus();
        }
    });

    row.querySelector('.pose-del').addEventListener('click', () => {
        row.remove();
        if (posesList.children.length === 0) addPoseRow();
    });

    posesList.appendChild(row);
}

document.getElementById('btn-add-pose')?.addEventListener('click', () => {
    addPoseRow();
    const rows = posesList.querySelectorAll('.pose-row');
    rows[rows.length - 1].querySelector('.alias').focus();
});

// ── Guardar ───────────────────────────────────────────────────────────────────

async function saveForm() {
    formError.textContent = '';

    const id          = fId.value.trim();
    const name        = fName.value.trim();
    const basePath    = fBasepath.value.trim();
    const voicePrefix = fVoice.value.trim();

    // Validaciones
    if (!id)       return showError('El ID es obligatorio.');
    if (!name)     return showError('El nombre es obligatorio.');
    if (!basePath) return showError('El basePath es obligatorio.');
    if (!/^\w+$/.test(id))         return showError('El ID solo puede tener letras, números y _');
    if (!basePath.startsWith('/')) return showError('basePath debe empezar con /');
    if (!basePath.endsWith('/'))   return showError('basePath debe terminar con /');

    // Recoger poses desde las filas dinámicas
    const poses = [];
    let poseError = null;

    posesList.querySelectorAll('.pose-row').forEach((row, i) => {
        if (poseError) return;
        const alias = row.querySelector('.alias').value.trim();
        const file  = row.querySelector('.file').value.trim();

        if (!alias && !file) return; // fila vacía, ignorar

        if (alias && !file) { poseError = `Pose ${i + 1}: falta el nombre de archivo.`; return; }
        if (!alias && file) { poseError = `Pose ${i + 1}: falta el alias.`; return; }
        if (poses.some(p => p.alias === alias)) { poseError = `Alias duplicado: "${alias}"`; return; }

        poses.push({ alias, file });
    });

    if (poseError) return showError(poseError);

    // Verificar duplicado solo en creación
    if (!editingId) {
        const existing = await db.characters.get(id);
        if (existing) return showError(`Ya existe un personaje con id "${id}".`);
    }

    await db.characters.put({ id, name, basePath, voicePrefix, poses });
    console.log(`[Characters] ${editingId ? 'Actualizado' : 'Creado'}: ${id}`, { basePath, voicePrefix, poses });
    closeForm();
    await renderList();
}

function showError(msg) { formError.textContent = msg; }

// ─── Export seed.js ───────────────────────────────────────────────────────────

async function openExport() {
    const chars = await db.characters.toArray();

    if (chars.length === 0) {
        alert('No hay personajes en la DB para exportar.');
        return;
    }

    const lines = chars.map(c => {
        const posesArr = (c.poses ?? [])
            .filter(p => p.alias)
            .map(p => `            { alias: '${p.alias}', file: '${p.file}' }`)
            .join(',\n');

        return `        {
            id:          '${c.id}',
            name:        '${c.name}',
            basePath:    '${c.basePath}',
            voicePrefix: '${c.voicePrefix ?? ''}',
            poses: [
${posesArr}
            ],
        }`;
    }).join(',\n');

    const output = `// Generado automáticamente desde /dev/characters.html
// Fecha: ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}
// Pegar dentro de seedProductionDB() en src/core/database/seed.js

const characters = [
${lines}
];

for (const char of characters) {
    const exists = await db.characters.get(char.id);
    if (!exists) await db.characters.put(char);
}`;

    exportCode.textContent = output;
    exportModal.classList.add('open');
}

document.getElementById('btn-export')?.addEventListener('click', openExport);
document.getElementById('btn-export-close')?.addEventListener('click', () => exportModal.classList.remove('open'));

document.getElementById('btn-export-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(exportCode.textContent)
        .then(() => {
            const btn = document.getElementById('btn-export-copy');
            const orig = btn.textContent;
            btn.textContent = '✓ Copiado';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
});

document.getElementById('btn-export-dl')?.addEventListener('click', () => {
    const blob = new Blob([exportCode.textContent], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'seed_characters.js';
    a.click();
    URL.revokeObjectURL(url);
});

// ─── Binds globales ───────────────────────────────────────────────────────────

document.getElementById('btn-new')?.addEventListener('click', () => openForm());
document.getElementById('btn-form-close')?.addEventListener('click', closeForm);
document.getElementById('btn-form-cancel')?.addEventListener('click', closeForm);
document.getElementById('btn-form-save')?.addEventListener('click', saveForm);

document.getElementById('btn-log-all')?.addEventListener('click', async () => {
    const chars = await db.characters.toArray();
    console.table(chars.map(c => ({ id: c.id, name: c.name, poses: c.poses?.length ?? 0, basePath: c.basePath })));
});

// Cerrar con ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (exportModal.classList.contains('open')) { exportModal.classList.remove('open'); return; }
        if (formPanel.classList.contains('open'))   { closeForm(); return; }
    }
    // Enter en los campos principales guarda el formulario
    if (e.key === 'Enter' && formPanel.classList.contains('open')) {
        const active = document.activeElement;
        if (active?.classList.contains('pose-input')) return; // lo maneja la fila
        saveForm();
    }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

renderList();
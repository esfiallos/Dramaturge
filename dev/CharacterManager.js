// dev/CharacterManager.js
//
// RESPONSABILIDADES:
//   - CRUD completo de personajes en Dexie
//   - Log detallado con poses
//   - UI montada en el panel #char-panel del lab
//
// USO:
//   import { CharacterManager } from './CharacterManager.js';
//   const cm = new CharacterManager(db);
//   cm.mount(document.getElementById('char-panel'));

export class CharacterManager {

    constructor(db) {
        this.db        = db;
        this.container = null;
        this._editingId = null; // id del personaje en edición, null = creando nuevo
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MONTAJE
    // ─────────────────────────────────────────────────────────────────────────

    mount(container) {
        this.container = container;
        this._render('list');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LOG PÚBLICO (llamable desde consola o desde lab.js)
    // ─────────────────────────────────────────────────────────────────────────

    async logAll() {
        const chars = await this.db.characters.toArray();
        if (chars.length === 0) {
            console.log('[CharacterManager] No hay personajes en la DB.');
            return;
        }
        console.group(`[CharacterManager] ${chars.length} personaje(s) en DB:`);
        chars.forEach(c => {
            console.group(`  ▸ ${c.name} (${c.id})`);
            console.log(`    basePath:    ${c.basePath}`);
            console.log(`    voicePrefix: ${c.voicePrefix}`);
            console.log(`    poses (${c.poses.length}):`);
            c.poses.forEach(p => console.log(`      · ${p.alias} → ${p.file}`));
            console.groupEnd();
        });
        console.groupEnd();
        return chars;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VISTAS
    // ─────────────────────────────────────────────────────────────────────────

    async _render(view, data = {}) {
        if (!this.container) return;
        switch (view) {
            case 'list':   return this._renderList();
            case 'create': return this._renderForm(null);
            case 'edit':   return this._renderForm(data.character);
        }
    }

    async _renderList() {
        const chars = await this.db.characters.toArray();
        const count = chars.length;

        this.container.innerHTML = `
            <div class="cm-toolbar">
                <span class="cm-count">${count} personaje${count !== 1 ? 's' : ''}</span>
                <button class="cm-btn cm-btn--primary" id="cm-btn-new">+ Nuevo personaje</button>
            </div>

            <div class="cm-list" id="cm-list">
                ${count === 0
                    ? `<div class="cm-empty">No hay personajes. Crea el primero.</div>`
                    : chars.map(c => this._renderCharCard(c)).join('')
                }
            </div>
        `;

        this.container.querySelector('#cm-btn-new')
            ?.addEventListener('click', () => this._render('create'));

        chars.forEach(c => {
            this.container.querySelector(`#cm-edit-${c.id}`)
                ?.addEventListener('click', () => this._render('edit', { character: c }));

            this.container.querySelector(`#cm-delete-${c.id}`)
                ?.addEventListener('click', () => this._confirmDelete(c));
        });
    }

    _renderCharCard(c) {
        const poseList = c.poses
            .map(p => `<span class="cm-pose-tag">${p.alias}<span class="cm-pose-file">${p.file}</span></span>`)
            .join('');

        return `
            <div class="cm-card" id="cm-card-${c.id}">
                <div class="cm-card-header">
                    <div>
                        <span class="cm-char-name">${c.name}</span>
                        <span class="cm-char-id">${c.id}</span>
                    </div>
                    <div class="cm-card-actions">
                        <button class="cm-btn cm-btn--sm" id="cm-edit-${c.id}">Editar</button>
                        <button class="cm-btn cm-btn--sm cm-btn--danger" id="cm-delete-${c.id}">Eliminar</button>
                    </div>
                </div>
                <div class="cm-card-meta">
                    <span class="cm-meta-item"><span class="cm-meta-label">basePath</span>${c.basePath}</span>
                    <span class="cm-meta-item"><span class="cm-meta-label">voicePrefix</span>${c.voicePrefix || '—'}</span>
                </div>
                <div class="cm-poses">
                    ${poseList || '<span class="cm-empty-inline">Sin poses</span>'}
                </div>
            </div>
        `;
    }

    _renderForm(character) {
        const isEdit = !!character;
        const c = character ?? { id: '', name: '', basePath: '', voicePrefix: '', poses: [] };

        // Serializar poses para el campo textarea
        const posesText = c.poses
            .map(p => `${p.alias}: ${p.file}`)
            .join('\n');

        this.container.innerHTML = `
            <div class="cm-toolbar">
                <button class="cm-btn" id="cm-btn-back">← Volver</button>
                <span class="cm-count">${isEdit ? `Editando: ${c.name}` : 'Nuevo personaje'}</span>
            </div>

            <div class="cm-form">

                <div class="cm-form-row">
                    <label class="cm-label" for="cm-id">ID interno <span class="cm-hint">snake_case, sin espacios. Ej: valeria</span></label>
                    <input class="cm-input" id="cm-id" type="text" value="${c.id}"
                        ${isEdit ? 'disabled title="El ID no se puede cambiar"' : ''}>
                </div>

                <div class="cm-form-row">
                    <label class="cm-label" for="cm-name">Nombre mostrado <span class="cm-hint">Aparece en los diálogos. Ej: Valeria</span></label>
                    <input class="cm-input" id="cm-name" type="text" value="${c.name}">
                </div>

                <div class="cm-form-row">
                    <label class="cm-label" for="cm-basepath">basePath <span class="cm-hint">Carpeta de sprites. Empezar con /. Ej: /assets/sprites/v/</span></label>
                    <input class="cm-input" id="cm-basepath" type="text" value="${c.basePath}" placeholder="/assets/sprites/v/">
                </div>

                <div class="cm-form-row">
                    <label class="cm-label" for="cm-voice">voicePrefix <span class="cm-hint">Prefijo de archivos de voz. Ej: VAL_</span></label>
                    <input class="cm-input" id="cm-voice" type="text" value="${c.voicePrefix}" placeholder="VAL_">
                </div>

                <div class="cm-form-row">
                    <label class="cm-label" for="cm-poses">
                        Poses
                        <span class="cm-hint">Una por línea, formato: alias: archivo.png</span>
                    </label>
                    <textarea class="cm-input cm-textarea" id="cm-poses" rows="6" placeholder="neutral: v_idle.png
triste: v_sad.png
sorpresa: v_surprised.png">${posesText}</textarea>
                </div>

                <div class="cm-form-error" id="cm-error"></div>

                <div class="cm-form-actions">
                    <button class="cm-btn cm-btn--primary" id="cm-btn-save">
                        ${isEdit ? 'Guardar cambios' : 'Crear personaje'}
                    </button>
                </div>

            </div>
        `;

        this.container.querySelector('#cm-btn-back')
            ?.addEventListener('click', () => this._render('list'));

        this.container.querySelector('#cm-btn-save')
            ?.addEventListener('click', () => this._saveForm(isEdit, c.id));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LÓGICA DE GUARDADO
    // ─────────────────────────────────────────────────────────────────────────

    async _saveForm(isEdit, originalId) {
        const errorEl = this.container.querySelector('#cm-error');
        errorEl.textContent = '';

        const id          = (this.container.querySelector('#cm-id')?.value ?? '').trim();
        const name        = (this.container.querySelector('#cm-name')?.value ?? '').trim();
        const basePath    = (this.container.querySelector('#cm-basepath')?.value ?? '').trim();
        const voicePrefix = (this.container.querySelector('#cm-voice')?.value ?? '').trim();
        const posesRaw    = (this.container.querySelector('#cm-poses')?.value ?? '').trim();

        // Validaciones
        if (!id)       return this._showError('El ID es obligatorio.');
        if (!name)     return this._showError('El nombre es obligatorio.');
        if (!basePath) return this._showError('El basePath es obligatorio.');
        if (!/^\w+$/.test(id)) return this._showError('El ID solo puede tener letras, números y _');
        if (!basePath.startsWith('/')) return this._showError('basePath debe empezar con /');
        if (!basePath.endsWith('/'))   return this._showError('basePath debe terminar con /');

        // Parsear poses — cada línea: "alias: archivo.ext"
        const poses = [];
        if (posesRaw) {
            for (const line of posesRaw.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const colon = trimmed.indexOf(':');
                if (colon === -1) {
                    return this._showError(`Pose con formato incorrecto: "${trimmed}". Usar "alias: archivo"`);
                }
                const alias = trimmed.slice(0, colon).trim();
                const file  = trimmed.slice(colon + 1).trim();
                if (!alias || !file) {
                    return this._showError(`Pose incompleta: "${trimmed}"`);
                }
                poses.push({ alias, file });
            }
        }

        // Verificar duplicado de ID en creación
        if (!isEdit) {
            const existing = await this.db.characters.get(id);
            if (existing) return this._showError(`Ya existe un personaje con id "${id}".`);
        }

        const record = { id, name, basePath, voicePrefix, poses };

        if (isEdit) {
            await this.db.characters.put(record);
            console.log(`[CharacterManager] Personaje actualizado: ${id}`);
        } else {
            await this.db.characters.add(record);
            console.log(`[CharacterManager] Personaje creado: ${id}`);
        }

        this._render('list');
    }

    async _confirmDelete(character) {
        const card = this.container.querySelector(`#cm-card-${character.id}`);
        if (!card) return;

        // Sustituir la card con una confirmación inline — sin alert()
        card.innerHTML = `
            <div class="cm-confirm">
                <span>¿Eliminar <strong>${character.name}</strong>? Esta acción no se puede deshacer.</span>
                <div class="cm-confirm-actions">
                    <button class="cm-btn cm-btn--danger" id="cm-confirm-yes-${character.id}">Eliminar</button>
                    <button class="cm-btn" id="cm-confirm-no-${character.id}">Cancelar</button>
                </div>
            </div>
        `;

        card.querySelector(`#cm-confirm-yes-${character.id}`)
            ?.addEventListener('click', async () => {
                await this.db.characters.delete(character.id);
                console.log(`[CharacterManager] Personaje eliminado: ${character.id}`);
                this._render('list');
            });

        card.querySelector(`#cm-confirm-no-${character.id}`)
            ?.addEventListener('click', () => this._render('list'));
    }

    _showError(msg) {
        const el = this.container?.querySelector('#cm-error');
        if (el) el.textContent = msg;
    }
}
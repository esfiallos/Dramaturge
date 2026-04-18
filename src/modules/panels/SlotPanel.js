// src/modules/panels/SlotPanel.js
//
// RESPONSABILIDAD:
//   Renderizar los slots de guardado y notificar acciones al orquestador.
//   No ejecuta saves ni loads — solo comunica la intención via callbacks.
//
// CONFIGURACIÓN DE SLOTS:
//   Los IDs y nombres viven en src/config/slots.js — fuente única de verdad.
//   Si se añade un slot nuevo, solo hay que editar ese archivo.

import { SLOT_CONFIG } from '../../config/slots.js';

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'save' | 'load'} SlotPanelMode
 */

/**
 * @typedef {Object} SlotData
 * @property {string}      slotId
 * @property {string}      displayName
 * @property {number|null} savedAt
 * @property {string|null} currentFile
 */

/**
 * @typedef {Object} SlotPanelEvents
 * @property {(slotId: string) => void}                       onSaveRequested
 * @property {(slotId: string) => void}                       onLoadRequested
 * @property {(slotId: string, displayName: string) => void}  onDeleteRequested
 * @property {() => void}                                     onClose
 */

// ─── SlotPanel ────────────────────────────────────────────────────────────────

/**
 * @example
 * const slotPanel = new SlotPanel([], {
 *     onSaveRequested:   (id) => engine.saveToSlot(id),
 *     onLoadRequested:   (id) => engine.loadFromSlot(id),
 *     onDeleteRequested: (id, name) => confirmAndDelete(id, name),
 *     onClose:           () => slotPanel.hide(),
 * });
 * slotPanel.mount(document.body);
 */
export class SlotPanel {

    /** @type {SlotData[]} */
    #availableSlots;

    /** @type {SlotPanelEvents} */
    #events;

    /** @type {HTMLElement} */
    #rootElement;

    /** @type {HTMLElement} */
    #slotListElement;

    /** @type {HTMLElement} */
    #titleElement;

    /** @type {SlotPanelMode} */
    #currentMode = 'load';

    /**
     * @param {SlotData[]}      availableSlots
     * @param {SlotPanelEvents} events
     */
    constructor(availableSlots, events) {
        this.#availableSlots = availableSlots;
        this.#events         = events;
        this.#rootElement    = this.#buildRootElement();
    }

    // ── API pública ────────────────────────────────────────────────────────

    /** Inserta el panel en el DOM. Llamar una sola vez. */
    mount(parentElement) {
        parentElement.appendChild(this.#rootElement);
    }

    /**
     * Muestra el panel en el modo indicado con los slots actualizados.
     * @param {SlotPanelMode} mode
     * @param {SlotData[]}    freshSlots
     */
    open(mode, freshSlots) {
        this.#currentMode    = mode;
        this.#availableSlots = freshSlots;
        this.#titleElement.textContent = mode === 'save'
            ? '— Guardar Partida —'
            : '— Cargar Partida —';
        this.#renderSlots();
        this.#rootElement.classList.remove('dm-hidden');
    }

    /** Oculta el panel sin destruirlo. */
    hide() {
        this.#rootElement.classList.add('dm-hidden');
    }

    /** @returns {boolean} */
    get isOpen() {
        return !this.#rootElement.classList.contains('dm-hidden');
    }

    /** @returns {SlotPanelMode} */
    get currentMode() { return this.#currentMode; }

    /**
     * Actualiza los datos sin abrir el panel.
     * Útil para mantener el estado fresco tras un guardado externo.
     * @param {SlotData[]} freshSlots
     */
    updateSlots(freshSlots) {
        this.#availableSlots = freshSlots;
    }

    // ── Construcción del DOM ───────────────────────────────────────────────

    #buildRootElement() {
        const panel = document.createElement('div');
        panel.id        = 'dm-slot-panel';
        panel.className = 'dm-overlay dm-panel dm-hidden';

        const inner = document.createElement('div');
        inner.className = 'dm-panel__inner';

        this.#titleElement = document.createElement('h2');
        this.#titleElement.className = 'dm-panel__title';

        this.#slotListElement = document.createElement('div');
        this.#slotListElement.className = 'dm-slot-list';

        inner.append(this.#titleElement, this.#slotListElement, this.#buildBackButton());
        panel.appendChild(inner);
        return panel;
    }

    #buildBackButton() {
        const btn = document.createElement('button');
        btn.className   = 'btn-gold dm-panel__back';
        btn.textContent = '← Volver';
        btn.addEventListener('click', () => this.#events.onClose());
        return btn;
    }

    // ── Renderizado de slots ───────────────────────────────────────────────

    #renderSlots() {
        this.#slotListElement.innerHTML = '';

        // El autosave no aparece en el panel de guardado manual
        const visible = this.#currentMode === 'save'
            ? SLOT_CONFIG.IDS.filter(id => id !== 'autosave')
            : SLOT_CONFIG.IDS;

        for (const slotId of visible) {
            const slotData    = this.#availableSlots.find(s => s.slotId === slotId) ?? null;
            const displayName = SLOT_CONFIG.DISPLAY_NAMES[slotId];
            this.#slotListElement.appendChild(
                this.#buildSlotElement(slotId, displayName, slotData)
            );
        }
    }

    /**
     * @param {string}        slotId
     * @param {string}        displayName
     * @param {SlotData|null} slotData
     */
    #buildSlotElement(slotId, displayName, slotData) {
        const isEmpty = slotData === null || slotData.savedAt === null;
        const item    = document.createElement('div');
        item.className = `dm-slot-item${isEmpty ? ' dm-slot-item--empty' : ''}`;

        const name = document.createElement('span');
        name.className   = 'dm-slot-name';
        name.textContent = displayName;

        const meta = document.createElement('span');
        meta.className   = 'dm-slot-meta';
        meta.textContent = slotData
            ? new Date(slotData.savedAt).toLocaleDateString('es', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })
            : 'Vacío';

        item.append(name, meta);

        if (!isEmpty) {
            item.appendChild(this.#buildDeleteButton(slotId, displayName));
        }

        item.addEventListener('click', () => {
            if (this.#currentMode === 'save') {
                this.#events.onSaveRequested(slotId);
            } else if (slotData !== null) {
                this.#events.onLoadRequested(slotId);
            }
        });

        return item;
    }

    /**
     * @param {string} slotId
     * @param {string} displayName
     */
    #buildDeleteButton(slotId, displayName) {
        const btn = document.createElement('button');
        btn.className   = 'dm-slot-delete';
        btn.title       = 'Eliminar';
        btn.textContent = '✕';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.#events.onDeleteRequested(slotId, displayName);
        });
        return btn;
    }
}
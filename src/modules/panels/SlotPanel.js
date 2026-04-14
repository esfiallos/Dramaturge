// src/modules/panels/SlotPanel.js

import { SLOT_CONFIG } from '../../config/slots.js';

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
 * @property {(slotId: string) => void}                        onSaveRequested
 * @property {(slotId: string) => void}                        onLoadRequested
 * @property {(slotId: string, displayName: string) => void}   onDeleteRequested
 * @property {() => void}                                      onClose
 */

/**
 * Panel de guardado y carga de partidas.
 *
 * Responsabilidad única: renderizar los slots disponibles y notificar
 * las acciones del jugador mediante callbacks. No ejecuta saves ni loads.
 *
 * La configuración de qué slots existen viene de `src/config/slots.js`,
 * no de esta clase — SlotPanel solo sabe cómo renderizarlos.
 *
 * @example
 * const slotPanel = new SlotPanel([], {
 *     onSaveRequested:   (slotId) => engine.saveToSlot(slotId),
 *     onLoadRequested:   (slotId) => engine.loadFromSlot(slotId),
 *     onDeleteRequested: (slotId, name) => confirmAndDelete(slotId, name),
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

    /**
     * Inserta el panel en el DOM. Llamar una sola vez.
     * @param {HTMLElement} parentElement
     */
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
        this.#titleElement.textContent = this.#resolvePanelTitle(mode);
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
     * Actualiza los datos de los slots sin abrir el panel.
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

        const backButton = this.#buildBackButton();

        inner.append(this.#titleElement, this.#slotListElement, backButton);
        panel.appendChild(inner);

        return panel;
    }

    #buildBackButton() {
        const button = document.createElement('button');
        button.className   = 'btn-gold dm-panel__back';
        button.textContent = '← Volver';
        button.addEventListener('click', () => this.#events.onClose());
        return button;
    }

    // ── Renderizado de slots ───────────────────────────────────────────────

    #renderSlots() {
        this.#slotListElement.innerHTML = '';

        // El autosave no aparece en el panel de guardado manual
        const visibleSlotIds = this.#currentMode === 'save'
            ? SLOT_CONFIG.IDS.filter(id => id !== 'autosave')
            : SLOT_CONFIG.IDS;

        for (const slotId of visibleSlotIds) {
            const slotData    = this.#availableSlots.find(s => s.slotId === slotId) ?? null;
            const displayName = SLOT_CONFIG.DISPLAY_NAMES[slotId];
            const slotElement = this.#buildSlotElement(slotId, displayName, slotData);
            this.#slotListElement.appendChild(slotElement);
        }
    }

    /**
     * @param {string}        slotId
     * @param {string}        displayName
     * @param {SlotData|null} slotData
     */
    #buildSlotElement(slotId, displayName, slotData) {
        const isEmpty  = slotData === null || slotData.savedAt === null;
        const slotItem = document.createElement('div');
        slotItem.className = `dm-slot-item${isEmpty ? ' dm-slot-item--empty' : ''}`;

        slotItem.append(
            this.#buildSlotNameLabel(displayName),
            this.#buildSlotMetaLabel(slotData),
        );

        if (!isEmpty) {
            slotItem.appendChild(this.#buildDeleteButton(slotId, displayName));
        }

        slotItem.addEventListener('click', () => this.#handleSlotClick(slotId, slotData));

        return slotItem;
    }

    /** @param {string} displayName */
    #buildSlotNameLabel(displayName) {
        const label = document.createElement('span');
        label.className   = 'dm-slot-name';
        label.textContent = displayName;
        return label;
    }

    /** @param {SlotData|null} slotData */
    #buildSlotMetaLabel(slotData) {
        const label = document.createElement('span');
        label.className   = 'dm-slot-meta';
        label.textContent = slotData ? this.#formatSaveDate(slotData.savedAt) : 'Vacío';
        return label;
    }

    /**
     * @param {string} slotId
     * @param {string} displayName
     */
    #buildDeleteButton(slotId, displayName) {
        const button = document.createElement('button');
        button.className   = 'dm-slot-delete';
        button.title       = 'Eliminar';
        button.textContent = '✕';
        button.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            this.#events.onDeleteRequested(slotId, displayName);
        });
        return button;
    }

    // ── Interacción ────────────────────────────────────────────────────────

    /**
     * @param {string}        slotId
     * @param {SlotData|null} slotData
     */
    #handleSlotClick(slotId, slotData) {
        if (this.#currentMode === 'save') {
            this.#events.onSaveRequested(slotId);
        } else if (slotData !== null) {
            this.#events.onLoadRequested(slotId);
        }
    }

    // ── Utilidades ─────────────────────────────────────────────────────────

    /** @param {SlotPanelMode} mode */
    #resolvePanelTitle(mode) {
        return mode === 'save' ? '— Guardar Partida —' : '— Cargar Partida —';
    }

    /** @param {number} timestamp */
    #formatSaveDate(timestamp) {
        return new Date(timestamp).toLocaleDateString('es', {
            day:    '2-digit',
            month:  'short',
            year:   'numeric',
            hour:   '2-digit',
            minute: '2-digit',
        });
    }
}
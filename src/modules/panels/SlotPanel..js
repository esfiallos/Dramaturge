// src/modules/panels/SlotPanel.js

/**
 * @typedef {'save' | 'load'} SlotPanelMode
 */

/**
 * @typedef {Object} SlotData
 * @property {string}      slotId
 * @property {string}      displayName
 * @property {number|null} savedAt       - Timestamp o null si está vacío
 * @property {string|null} currentFile   - Escena guardada o null si está vacío
 */

/**
 * @typedef {Object} SlotPanelEvents
 * @property {(slotId: string) => void} onSaveRequested
 * @property {(slotId: string) => void} onLoadRequested
 * @property {(slotId: string, displayName: string) => void} onDeleteRequested
 * @property {() => void} onClose
 */

/**
 * Panel de guardado y carga de partidas.
 *
 * Responsabilidad única: renderizar los slots disponibles y notificar
 * las acciones del jugador mediante callbacks. No ejecuta saves ni loads —
 * solo comunica la intención al orquestador.
 *
 * @example
 * const slotPanel = new SlotPanel(availableSlots, {
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

    static #SLOT_IDS = ['autosave', 'slot_1', 'slot_2', 'slot_3'];

    static #SLOT_DISPLAY_NAMES = {
        autosave: 'Autoguardado',
        slot_1:   'Ranura 1',
        slot_2:   'Ranura 2',
        slot_3:   'Ranura 3',
    };

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
     * Muestra el panel en el modo indicado y renderiza los slots actuales.
     * @param {SlotPanelMode} mode
     * @param {SlotData[]}    freshSlots - Estado actualizado de los slots
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

    /** @returns {SlotPanelMode} */
    get currentMode() { return this.#currentMode; }

    /**
     * Actualiza los datos de los slots sin abrir el panel.
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

        const visibleSlotIds = this.#currentMode === 'save'
            ? SlotPanel.#SLOT_IDS.filter(id => id !== 'autosave')
            : SlotPanel.#SLOT_IDS;

        for (const slotId of visibleSlotIds) {
            const slotData    = this.#availableSlots.find(s => s.slotId === slotId) ?? null;
            const displayName = SlotPanel.#SLOT_DISPLAY_NAMES[slotId];
            const slotElement = this.#buildSlotElement(slotId, displayName, slotData);
            this.#slotListElement.appendChild(slotElement);
        }
    }

    /**
     * @param {string}       slotId
     * @param {string}       displayName
     * @param {SlotData|null} slotData
     */
    #buildSlotElement(slotId, displayName, slotData) {
        const isEmpty = slotData === null || slotData.savedAt === null;
        const slotItem = document.createElement('div');
        slotItem.className = `dm-slot-item${isEmpty ? ' dm-slot-item--empty' : ''}`;

        const nameLabel = this.#buildSlotNameLabel(displayName);
        const metaLabel = this.#buildSlotMetaLabel(slotData);

        slotItem.append(nameLabel, metaLabel);

        if (!isEmpty) {
            const deleteButton = this.#buildDeleteButton(slotId, displayName);
            slotItem.appendChild(deleteButton);
        }

        slotItem.addEventListener('click', () =>
            this.#handleSlotClick(slotId, slotData));

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
        label.textContent = slotData
            ? this.#formatSaveDate(slotData.savedAt)
            : 'Vacío';
        return label;
    }

    /**
     * @param {string} slotId
     * @param {string} displayName
     */
    #buildDeleteButton(slotId, displayName) {
        const button = document.createElement('button');
        button.className = 'dm-slot-delete';
        button.title     = 'Eliminar';
        button.textContent = '✕';
        button.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            this.#events.onDeleteRequested(slotId, displayName);
        });
        return button;
    }

    // ── Interacción ────────────────────────────────────────────────────────

    /**
     * @param {string}       slotId
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
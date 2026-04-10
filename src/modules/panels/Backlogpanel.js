// src/modules/panels/BacklogPanel.js

/**
 * @typedef {Object} BacklogEntry
 * @property {string|null} speaker - Nombre del personaje o null si es narración
 * @property {string}      text    - Texto del diálogo o narración
 */

/**
 * @typedef {Object} BacklogPanelEvents
 * @property {() => void} onClose
 */

/**
 * Panel de historial de diálogos al estilo Umineko.
 *
 * Responsabilidad única: renderizar las entradas del backlog del engine
 * y notificar el cierre al orquestador. Solo lectura — no modifica el engine.
 *
 * Las entradas sin speaker se renderizan como narración (cursiva, sin nombre).
 * Las entradas con speaker se renderizan como diálogo (nombre destacado + texto).
 *
 * @example
 * const backlogPanel = new BacklogPanel({
 *     onClose: () => backlogPanel.hide(),
 * });
 * backlogPanel.mount(document.body);
 * backlogPanel.open(engine.backlog);
 */
export class BacklogPanel {

    /** @type {BacklogPanelEvents} */
    #events;

    /** @type {HTMLElement} */
    #rootElement;

    /** @type {HTMLElement} */
    #entryListElement;

    /** @param {BacklogPanelEvents} events */
    constructor(events) {
        this.#events      = events;
        this.#rootElement = this.#buildRootElement();
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
     * Muestra el panel con las entradas del backlog actuales.
     * Hace scroll automático a la entrada más reciente.
     * @param {BacklogEntry[]} entries
     */
    open(entries) {
        this.#renderEntries(entries);
        this.#rootElement.classList.remove('dm-hidden');
        this.#scrollToLatestEntry();
    }

    /** Oculta el panel sin destruirlo ni limpiar las entradas. */
    hide() {
        this.#rootElement.classList.add('dm-hidden');
    }

    /** @returns {boolean} */
    get isOpen() {
        return !this.#rootElement.classList.contains('dm-hidden');
    }

    // ── Construcción del DOM ───────────────────────────────────────────────

    #buildRootElement() {
        const panel = document.createElement('div');
        panel.id        = 'dm-backlog';
        panel.className = 'dm-hidden';

        const inner = document.createElement('div');
        inner.className = 'dm-backlog__inner';

        const header = this.#buildHeader();

        this.#entryListElement = document.createElement('div');
        this.#entryListElement.className = 'dm-backlog__list';

        inner.append(header, this.#entryListElement);
        panel.appendChild(inner);

        panel.addEventListener('wheel', (wheelEvent) => {
            wheelEvent.stopPropagation();
        }, { passive: true });

        return panel;
    }

    #buildHeader() {
        const header = document.createElement('div');
        header.className = 'dm-backlog__header';

        const title = document.createElement('span');
        title.className   = 'dm-backlog__title';
        title.textContent = 'Historial';

        const closeButton = document.createElement('button');
        closeButton.className   = 'dm-backlog__close';
        closeButton.textContent = '✕';
        closeButton.addEventListener('click', () => this.#events.onClose());

        header.append(title, closeButton);
        return header;
    }

    // ── Renderizado de entradas ────────────────────────────────────────────

    /** @param {BacklogEntry[]} entries */
    #renderEntries(entries) {
        this.#entryListElement.innerHTML = '';
        const entryElements = entries.map(entry => this.#buildEntryElement(entry));
        this.#entryListElement.append(...entryElements);
    }

    /** @param {BacklogEntry} entry */
    #buildEntryElement(entry) {
        const isNarration = entry.speaker === null;
        return isNarration
            ? this.#buildNarrationEntry(entry.text)
            : this.#buildDialogueEntry(entry.speaker, entry.text);
    }

    /** @param {string} text */
    #buildNarrationEntry(text) {
        const entryElement = document.createElement('div');
        entryElement.className = 'dm-backlog__entry dm-backlog__entry--narrate';

        const textSpan = document.createElement('span');
        textSpan.className   = 'dm-backlog__text dm-backlog__text--narrate';
        textSpan.textContent = text;

        entryElement.appendChild(textSpan);
        return entryElement;
    }

    /**
     * @param {string} speakerName
     * @param {string} text
     */
    #buildDialogueEntry(speakerName, text) {
        const entryElement = document.createElement('div');
        entryElement.className = 'dm-backlog__entry dm-backlog__entry--dialogue';

        const speakerSpan = document.createElement('span');
        speakerSpan.className   = 'dm-backlog__speaker';
        speakerSpan.textContent = speakerName;

        const textSpan = document.createElement('span');
        textSpan.className   = 'dm-backlog__text';
        textSpan.textContent = text;

        entryElement.append(speakerSpan, textSpan);
        return entryElement;
    }

    // ── Scroll ─────────────────────────────────────────────────────────────

    #scrollToLatestEntry() {
        this.#entryListElement.scrollTop = this.#entryListElement.scrollHeight;
    }
}
// src/modules/panels/GalleryPanel.js

/**
 * @typedef {Object} GalleryEntry
 * @property {string} id         - Identificador del CG
 * @property {string} title      - Título visible en la galería
 * @property {string} path       - Ruta base sin extensión
 * @property {number} unlockedAt - Timestamp de desbloqueo
 */

/**
 * @typedef {Object} GalleryPanelEvents
 * @property {() => void} onClose
 */

/**
 * Panel de galería de CGs desbloqueados con lightbox integrado.
 *
 * Responsabilidad única: renderizar el grid de CGs disponibles,
 * gestionar la navegación del lightbox y notificar el cierre.
 * No accede a la DB directamente — recibe las entradas ya resueltas.
 *
 * @example
 * const galleryPanel = new GalleryPanel({ onClose: () => galleryPanel.hide() });
 * galleryPanel.mount(document.body);
 * galleryPanel.open(unlockedEntries);
 */
export class GalleryPanel {

    /** @type {GalleryPanelEvents} */
    #events;

    /** @type {HTMLElement} */
    #rootElement;

    /** @type {HTMLElement} */
    #gridElement;

    /** @type {HTMLElement} */
    #lightboxElement;

    /** @type {HTMLImageElement} */
    #lightboxImageElement;

    /** @type {HTMLElement} */
    #lightboxCaptionElement;

    /** @type {GalleryEntry[]} */
    #currentEntries = [];

    /** @type {number} */
    #activeLightboxIndex = 0;

    /** @param {GalleryPanelEvents} events */
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
     * Muestra el panel con las entradas de galería proporcionadas.
     * @param {GalleryEntry[]} entries
     */
    open(entries) {
        this.#currentEntries = entries;
        this.#renderGrid();
        this.#rootElement.classList.remove('dm-hidden');
    }

    /** Oculta el panel y cierra el lightbox si está abierto. */
    hide() {
        this.#closeLightbox();
        this.#rootElement.classList.add('dm-hidden');
    }

    /** @returns {boolean} */
    get isOpen() {
        return !this.#rootElement.classList.contains('dm-hidden');
    }

    /**
     * Navega el lightbox en la dirección indicada.
     * Llamable desde el teclado en el orquestador.
     * @param {-1 | 1} direction
     */
    navigateLightbox(direction) {
        if (this.#currentEntries.length === 0) return;
        this.#activeLightboxIndex =
            (this.#activeLightboxIndex + direction + this.#currentEntries.length)
            % this.#currentEntries.length;
        this.#updateLightboxContent();
    }

    // ── Construcción del DOM ───────────────────────────────────────────────

    #buildRootElement() {
        const panel = document.createElement('div');
        panel.id        = 'dm-gallery';
        panel.className = 'dm-hidden';

        const inner = document.createElement('div');
        inner.className = 'dm-gallery__inner';

        const header = this.#buildPanelHeader();

        this.#gridElement = document.createElement('div');
        this.#gridElement.className = 'dm-gallery__grid';

        inner.append(header, this.#gridElement);
        panel.appendChild(inner);

        const lightbox = this.#buildLightbox();
        panel.appendChild(lightbox);

        return panel;
    }

    #buildPanelHeader() {
        const header = document.createElement('div');
        header.className = 'dm-gallery__header';

        const title = document.createElement('span');
        title.className   = 'dm-gallery__title';
        title.textContent = 'Galería';

        const closeButton = document.createElement('button');
        closeButton.className   = 'dm-gallery__close';
        closeButton.textContent = '✕';
        closeButton.addEventListener('click', () => this.#events.onClose());

        header.append(title, closeButton);
        return header;
    }

    #buildLightbox() {
        this.#lightboxElement = document.createElement('div');
        this.#lightboxElement.className = 'dm-gallery__lightbox dm-hidden';

        const closeButton = this.#buildLightboxButton(
            'dm-gallery__lb-close', '✕', () => this.#closeLightbox());

        const prevButton = this.#buildLightboxButton(
            'dm-gallery__lb-prev', '‹', () => this.navigateLightbox(-1));

        const nextButton = this.#buildLightboxButton(
            'dm-gallery__lb-next', '›', () => this.navigateLightbox(1));

        this.#lightboxImageElement = document.createElement('img');
        this.#lightboxImageElement.className = 'dm-gallery__lb-img';
        this.#lightboxImageElement.alt       = '';

        this.#lightboxCaptionElement = document.createElement('div');
        this.#lightboxCaptionElement.className = 'dm-gallery__lb-caption';

        this.#lightboxElement.addEventListener('click', (clickEvent) => {
            if (clickEvent.target === this.#lightboxElement) this.#closeLightbox();
        });

        this.#lightboxElement.append(
            closeButton,
            prevButton,
            this.#lightboxImageElement,
            this.#lightboxCaptionElement,
            nextButton,
        );

        return this.#lightboxElement;
    }

    /**
     * @param {string}   className
     * @param {string}   label
     * @param {Function} onClick
     */
    #buildLightboxButton(className, label, onClick) {
        const button = document.createElement('button');
        button.className   = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    // ── Renderizado del grid ───────────────────────────────────────────────

    #renderGrid() {
        this.#gridElement.innerHTML = '';

        if (this.#currentEntries.length === 0) {
            this.#gridElement.appendChild(this.#buildEmptyStateElement());
            return;
        }

        const thumbnails = this.#currentEntries.map((entry, entryIndex) =>
            this.#buildThumbnailElement(entry, entryIndex));

        this.#gridElement.append(...thumbnails);
    }

    #buildEmptyStateElement() {
        const emptyState = document.createElement('div');
        emptyState.className = 'dm-gallery__empty';
        emptyState.innerHTML = `
            Todavía no hay imágenes desbloqueadas.<br>
            <span>Continúa jugando para descubrirlas.</span>
        `;
        return emptyState;
    }

    /**
     * @param {GalleryEntry} entry
     * @param {number}       entryIndex
     */
    #buildThumbnailElement(entry, entryIndex) {
        const thumbnailButton = document.createElement('button');
        thumbnailButton.className = 'dm-gallery__thumb';
        thumbnailButton.title     = entry.title;
        thumbnailButton.dataset.index = String(entryIndex);

        const thumbnailImage = document.createElement('img');
        thumbnailImage.src = `${entry.path}.webp`;
        thumbnailImage.alt = entry.title;
        thumbnailImage.addEventListener('error', () => {
            thumbnailImage.src = `${entry.path}.png`;
        }, { once: true });

        const captionLabel = document.createElement('span');
        captionLabel.className   = 'dm-gallery__thumb-label';
        captionLabel.textContent = entry.title;

        thumbnailButton.append(thumbnailImage, captionLabel);
        thumbnailButton.addEventListener('click', () => this.#openLightbox(entryIndex));

        return thumbnailButton;
    }

    // ── Lightbox ───────────────────────────────────────────────────────────

    /** @param {number} entryIndex */
    #openLightbox(entryIndex) {
        this.#activeLightboxIndex = entryIndex;
        this.#updateLightboxContent();
        this.#lightboxElement.classList.remove('dm-hidden');
    }

    #closeLightbox() {
        this.#lightboxElement.classList.add('dm-hidden');
    }

    #updateLightboxContent() {
        const activeEntry = this.#currentEntries[this.#activeLightboxIndex];
        if (!activeEntry) return;

        this.#lightboxImageElement.src = `${activeEntry.path}.webp`;
        this.#lightboxImageElement.alt = activeEntry.title;
        this.#lightboxImageElement.addEventListener('error', () => {
            this.#lightboxImageElement.src = `${activeEntry.path}.png`;
        }, { once: true });

        this.#lightboxCaptionElement.textContent = activeEntry.title;
    }
}
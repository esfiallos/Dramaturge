// src/modules/panels/GalleryPanel.js
//
// RESPONSABILIDAD:
//   Renderizar el grid de CGs desbloqueados y gestionar el lightbox integrado.
//   No accede a la DB — recibe las entradas ya resueltas desde MenuSystem.

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} GalleryEntry
 * @property {string} id
 * @property {string} title
 * @property {string} path        — ruta base sin extensión
 * @property {number} unlockedAt
 */

/**
 * @typedef {Object} GalleryPanelEvents
 * @property {() => void} onClose
 */

// ─── GalleryPanel ─────────────────────────────────────────────────────────────

/**
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
    #lightboxImage;

    /** @type {HTMLElement} */
    #lightboxCaption;

    /** @type {GalleryEntry[]} */
    #entries = [];

    /** @type {number} */
    #lightboxIndex = 0;

    /** @param {GalleryPanelEvents} events */
    constructor(events) {
        this.#events      = events;
        this.#rootElement = this.#buildRootElement();
    }

    // ── API pública ────────────────────────────────────────────────────────

    /** Inserta el panel en el DOM. Llamar una sola vez. */
    mount(parentElement) {
        parentElement.appendChild(this.#rootElement);
    }

    /**
     * Muestra el panel con las entradas proporcionadas.
     * @param {GalleryEntry[]} entries
     */
    open(entries) {
        this.#entries = entries;
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
     * Llamable desde el teclado en MenuSystem.
     * @param {-1 | 1} direction
     */
    navigateLightbox(direction) {
        if (this.#entries.length === 0) return;
        this.#lightboxIndex =
            (this.#lightboxIndex + direction + this.#entries.length)
            % this.#entries.length;
        this.#updateLightboxContent();
    }

    // ── Construcción del DOM ───────────────────────────────────────────────

    #buildRootElement() {
        const panel = document.createElement('div');
        panel.id        = 'dm-gallery';
        panel.className = 'dm-hidden';

        const inner = document.createElement('div');
        inner.className = 'dm-gallery__inner';

        this.#gridElement = document.createElement('div');
        this.#gridElement.className = 'dm-gallery__grid';

        inner.append(this.#buildHeader(), this.#gridElement);
        panel.append(inner, this.#buildLightbox());
        return panel;
    }

    #buildHeader() {
        const header = document.createElement('div');
        header.className = 'dm-gallery__header';

        const title = document.createElement('span');
        title.className   = 'dm-gallery__title';
        title.textContent = 'Galería';

        const close = document.createElement('button');
        close.className   = 'dm-gallery__close';
        close.textContent = '✕';
        close.addEventListener('click', () => this.#events.onClose());

        header.append(title, close);
        return header;
    }

    #buildLightbox() {
        this.#lightboxElement = document.createElement('div');
        this.#lightboxElement.className = 'dm-gallery__lightbox dm-hidden';

        this.#lightboxImage = document.createElement('img');
        this.#lightboxImage.className = 'dm-gallery__lb-img';
        this.#lightboxImage.alt       = '';

        this.#lightboxCaption = document.createElement('div');
        this.#lightboxCaption.className = 'dm-gallery__lb-caption';

        this.#lightboxElement.append(
            this.#buildLightboxBtn('dm-gallery__lb-close', '✕', () => this.#closeLightbox()),
            this.#buildLightboxBtn('dm-gallery__lb-prev',  '‹', () => this.navigateLightbox(-1)),
            this.#lightboxImage,
            this.#lightboxCaption,
            this.#buildLightboxBtn('dm-gallery__lb-next',  '›', () => this.navigateLightbox(1)),
        );

        // Clic en el fondo del lightbox lo cierra
        this.#lightboxElement.addEventListener('click', (e) => {
            if (e.target === this.#lightboxElement) this.#closeLightbox();
        });

        return this.#lightboxElement;
    }

    /**
     * @param {string}   className
     * @param {string}   label
     * @param {Function} onClick
     */
    #buildLightboxBtn(className, label, onClick) {
        const btn = document.createElement('button');
        btn.className   = className;
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ── Grid ───────────────────────────────────────────────────────────────

    #renderGrid() {
        this.#gridElement.innerHTML = '';

        if (this.#entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dm-gallery__empty';
            empty.innerHTML = `Todavía no hay imágenes desbloqueadas.<br>
                <span>Continúa jugando para descubrirlas.</span>`;
            this.#gridElement.appendChild(empty);
            return;
        }

        const thumbnails = this.#entries.map((entry, index) =>
            this.#buildThumbnail(entry, index));
        this.#gridElement.append(...thumbnails);
    }

    /**
     * @param {GalleryEntry} entry
     * @param {number}       index
     */
    #buildThumbnail(entry, index) {
        const btn = document.createElement('button');
        btn.className = 'dm-gallery__thumb';
        btn.title     = entry.title;

        const img = document.createElement('img');
        img.src = `${entry.path}.webp`;
        img.alt = entry.title;
        img.addEventListener('error', () => { img.src = `${entry.path}.png`; }, { once: true });

        const caption = document.createElement('span');
        caption.className   = 'dm-gallery__thumb-label';
        caption.textContent = entry.title;

        btn.append(img, caption);
        btn.addEventListener('click', () => this.#openLightbox(index));
        return btn;
    }

    // ── Lightbox ───────────────────────────────────────────────────────────

    /** @param {number} index */
    #openLightbox(index) {
        this.#lightboxIndex = index;
        this.#updateLightboxContent();
        this.#lightboxElement.classList.remove('dm-hidden');
    }

    #closeLightbox() {
        this.#lightboxElement.classList.add('dm-hidden');
    }

    #updateLightboxContent() {
        const entry = this.#entries[this.#lightboxIndex];
        if (!entry) return;

        this.#lightboxImage.src = `${entry.path}.webp`;
        this.#lightboxImage.alt = entry.title;
        this.#lightboxImage.addEventListener(
            'error', () => { this.#lightboxImage.src = `${entry.path}.png`; }, { once: true });

        this.#lightboxCaption.textContent = entry.title;
    }
}
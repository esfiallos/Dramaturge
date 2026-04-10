// src/modules/panels/ModalPanel.js

/**
 * @typedef {Object} ModalConfig
 * @property {string}        message       - Texto del cuerpo del modal
 * @property {string}        confirmLabel  - Texto del botón de confirmación
 * @property {string}        cancelLabel   - Texto del botón de cancelación
 * @property {() => void}    onConfirm     - Callback al confirmar
 * @property {() => void}    [onCancel]    - Callback al cancelar (opcional)
 */

/**
 * Modal de confirmación reutilizable.
 *
 * Responsabilidad única: mostrar un mensaje con dos acciones y
 * notificar la elección del jugador. Sin estado propio más allá
 * de si está visible o no.
 *
 * Expone además `prompt()` como API de alto nivel que devuelve
 * una Promise — permite usar await en el orquestador sin gestionar
 * callbacks manualmente.
 *
 * @example
 * const modalPanel = new ModalPanel();
 * modalPanel.mount(document.body);
 *
 * const playerConfirmed = await modalPanel.prompt({
 *     message:      '¿Sobrescribir la Ranura 1?',
 *     confirmLabel: 'Guardar',
 *     cancelLabel:  'Cancelar',
 * });
 */
export class ModalPanel {

    /** @type {HTMLElement} */
    #rootElement;

    /** @type {HTMLElement} */
    #messageElement;

    /** @type {HTMLButtonElement} */
    #confirmButton;

    /** @type {HTMLButtonElement} */
    #cancelButton;

    constructor() {
        this.#rootElement = this.#buildRootElement();
    }

    // ── API pública ────────────────────────────────────────────────────────

    /**
     * Inserta el modal en el DOM. Llamar una sola vez.
     * @param {HTMLElement} parentElement
     */
    mount(parentElement) {
        parentElement.appendChild(this.#rootElement);
    }

    /**
     * Muestra el modal con la configuración indicada.
     * @param {ModalConfig} config
     */
    open(config) {
        this.#messageElement.textContent  = config.message;
        this.#confirmButton.textContent   = config.confirmLabel;
        this.#cancelButton.textContent    = config.cancelLabel;

        this.#replaceButtonWithFreshClone('confirm', () => {
            this.hide();
            config.onConfirm();
        });

        this.#replaceButtonWithFreshClone('cancel', () => {
            this.hide();
            config.onCancel?.();
        });

        this.#rootElement.classList.remove('dm-hidden');
    }

    /**
     * API de alto nivel — muestra el modal y devuelve una Promise
     * que resuelve con true (confirmado) o false (cancelado).
     *
     * @param {{ message: string, confirmLabel: string, cancelLabel: string }} options
     * @returns {Promise<boolean>}
     */
    prompt(options) {
        return new Promise((resolve) => {
            this.open({
                ...options,
                onConfirm: () => resolve(true),
                onCancel:  () => resolve(false),
            });
        });
    }

    /** Oculta el modal. */
    hide() {
        this.#rootElement.classList.add('dm-hidden');
    }

    /** @returns {boolean} */
    get isOpen() {
        return !this.#rootElement.classList.contains('dm-hidden');
    }

    // ── Construcción del DOM ───────────────────────────────────────────────

    #buildRootElement() {
        const overlay = document.createElement('div');
        overlay.id        = 'dm-modal';
        overlay.className = 'dm-overlay dm-modal dm-hidden';

        const box = document.createElement('div');
        box.className = 'dm-modal__box';

        this.#messageElement = document.createElement('p');
        this.#messageElement.className = 'dm-modal__msg';

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'dm-modal__actions';

        this.#confirmButton = document.createElement('button');
        this.#confirmButton.className = 'btn-gold';

        this.#cancelButton = document.createElement('button');
        this.#cancelButton.className = 'btn-gold';

        actionsContainer.append(this.#confirmButton, this.#cancelButton);
        box.append(this.#messageElement, actionsContainer);
        overlay.appendChild(box);

        return overlay;
    }

    // ── Gestión de listeners ───────────────────────────────────────────────

    /**
     * Reemplaza el botón por un clon limpio antes de añadir el nuevo listener.
     * Evita la acumulación de listeners de aperturas anteriores.
     *
     * @param {'confirm' | 'cancel'} buttonRole
     * @param {() => void}           onClick
     */
    #replaceButtonWithFreshClone(buttonRole, onClick) {
        const isConfirm   = buttonRole === 'confirm';
        const staleButton = isConfirm ? this.#confirmButton : this.#cancelButton;
        const freshClone  = staleButton.cloneNode(true);

        freshClone.addEventListener('click', onClick);
        staleButton.replaceWith(freshClone);

        if (isConfirm) {
            this.#confirmButton = freshClone;
        } else {
            this.#cancelButton = freshClone;
        }
    }
}
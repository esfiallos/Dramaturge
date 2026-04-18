// src/modules/panels/AudioPanel.js
//
// RESPONSABILIDAD:
//   Renderizar sliders de volumen por canal y notificar cambios al orquestador.
//   No modifica AudioManager directamente — delega en callbacks.

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AudioChannelConfig
 * @property {number} bgmVolume   - 0.0 a 1.0
 * @property {number} sfxVolume   - 0.0 a 1.0
 * @property {number} voiceVolume - 0.0 a 1.0
 */

/**
 * @typedef {Object} AudioPanelEvents
 * @property {(channel: 'bgm' | 'se' | 'voice', volume: number) => void} onVolumeChanged
 * @property {() => void} onClose
 */

// ─── AudioPanel ───────────────────────────────────────────────────────────────

/**
 * @example
 * const audioPanel = new AudioPanel({
 *     onVolumeChanged: (channel, vol) => engine.updateAudioVolume(channel, vol),
 *     onClose:         () => audioPanel.hide(),
 * });
 * audioPanel.mount(document.body);
 */
export class AudioPanel {

    /** @type {AudioPanelEvents} */
    #events;

    /** @type {HTMLElement} */
    #rootElement;

    /** @type {HTMLInputElement} */
    #bgmSlider;

    /** @type {HTMLInputElement} */
    #sfxSlider;

    /** @type {HTMLInputElement} */
    #voiceSlider;

    /** @param {AudioPanelEvents} events */
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
     * Muestra el panel con los volúmenes actuales.
     * @param {AudioChannelConfig} currentConfig
     */
    open(currentConfig) {
        this.#bgmSlider.valueAsNumber   = Math.round(currentConfig.bgmVolume   * 100);
        this.#sfxSlider.valueAsNumber   = Math.round(currentConfig.sfxVolume   * 100);
        this.#voiceSlider.valueAsNumber = Math.round(currentConfig.voiceVolume * 100);
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

    // ── Construcción del DOM ───────────────────────────────────────────────

    #buildRootElement() {
        const panel = document.createElement('div');
        panel.id        = 'dm-audio-panel';
        panel.className = 'dm-overlay dm-panel dm-hidden';

        const inner = document.createElement('div');
        inner.className = 'dm-panel__inner';

        const title = document.createElement('h2');
        title.className   = 'dm-panel__title';
        title.textContent = '— Audio —';

        const bgmRow   = this.#buildVolumeRow('Música',  'bgm');
        const sfxRow   = this.#buildVolumeRow('Efectos', 'se');
        const voiceRow = this.#buildVolumeRow('Voces',   'voice');

        this.#bgmSlider   = bgmRow.slider;
        this.#sfxSlider   = sfxRow.slider;
        this.#voiceSlider = voiceRow.slider;

        inner.append(
            title,
            bgmRow.row,
            sfxRow.row,
            voiceRow.row,
            this.#buildBackButton(),
        );
        panel.appendChild(inner);
        return panel;
    }

    /**
     * @param {string}                  label
     * @param {'bgm' | 'se' | 'voice'} channel
     * @returns {{ row: HTMLElement, slider: HTMLInputElement }}
     */
    #buildVolumeRow(label, channel) {
        const row = document.createElement('div');
        row.className = 'dm-audio-row';

        const lbl = document.createElement('label');
        lbl.textContent = label;

        const slider = document.createElement('input');
        slider.type  = 'range';
        slider.min   = '0';
        slider.max   = '100';
        slider.value = '50';
        slider.addEventListener('input', () => {
            this.#events.onVolumeChanged(channel, slider.valueAsNumber / 100);
        });

        row.append(lbl, slider);
        return { row, slider };
    }

    #buildBackButton() {
        const btn = document.createElement('button');
        btn.className   = 'btn-gold dm-panel__back';
        btn.textContent = '← Volver';
        btn.addEventListener('click', () => this.#events.onClose());
        return btn;
    }
}
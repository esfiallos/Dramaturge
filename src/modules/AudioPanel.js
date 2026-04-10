// src/modules/panels/AudioPanel.js

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

/**
 * Panel de configuración de volúmenes por canal de audio.
 *
 * Responsabilidad única: renderizar los sliders de volumen y notificar
 * cambios al orquestador. No modifica el AudioManager directamente.
 *
 * @example
 * const audioPanel = new AudioPanel({
 *     onVolumeChanged: (channel, volume) => audioManager.setVolume(channel, volume),
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

    /**
     * Inserta el panel en el DOM. Llamar una sola vez.
     * @param {HTMLElement} parentElement
     */
    mount(parentElement) {
        parentElement.appendChild(this.#rootElement);
    }

    /**
     * Muestra el panel con los valores de volumen actuales.
     * @param {AudioChannelConfig} currentConfig
     */
    open(currentConfig) {
        this.#syncSlidersToConfig(currentConfig);
        this.#rootElement.classList.remove('dm-hidden');
    }

    /** Oculta el panel sin destruirlo. */
    hide() {
        this.#rootElement.classList.add('dm-hidden');
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
        const backButton = this.#buildBackButton();

        inner.append(title, bgmRow.rowElement, sfxRow.rowElement, voiceRow.rowElement, backButton);
        panel.appendChild(inner);

        this.#bgmSlider   = bgmRow.sliderElement;
        this.#sfxSlider   = sfxRow.sliderElement;
        this.#voiceSlider = voiceRow.sliderElement;

        return panel;
    }

    /**
     * @param {string}                        labelText
     * @param {'bgm' | 'se' | 'voice'}        channel
     * @returns {{ rowElement: HTMLElement, sliderElement: HTMLInputElement }}
     */
    #buildVolumeRow(labelText, channel) {
        const rowElement = document.createElement('div');
        rowElement.className = 'dm-audio-row';

        const label = document.createElement('label');
        label.textContent = labelText;

        const sliderElement = document.createElement('input');
        sliderElement.type  = 'range';
        sliderElement.min   = '0';
        sliderElement.max   = '100';
        sliderElement.value = '50';

        sliderElement.addEventListener('input', () => {
            const normalizedVolume = sliderElement.valueAsNumber / 100;
            this.#events.onVolumeChanged(channel, normalizedVolume);
        });

        rowElement.append(label, sliderElement);

        return { rowElement, sliderElement };
    }

    #buildBackButton() {
        const button = document.createElement('button');
        button.className   = 'btn-gold dm-panel__back';
        button.textContent = '← Volver';
        button.addEventListener('click', () => this.#events.onClose());
        return button;
    }

    // ── Sincronización ─────────────────────────────────────────────────────

    /** @param {AudioChannelConfig} config */
    #syncSlidersToConfig(config) {
        this.#bgmSlider.valueAsNumber   = Math.round(config.bgmVolume   * 100);
        this.#sfxSlider.valueAsNumber   = Math.round(config.sfxVolume   * 100);
        this.#voiceSlider.valueAsNumber = Math.round(config.voiceVolume * 100);
    }
}
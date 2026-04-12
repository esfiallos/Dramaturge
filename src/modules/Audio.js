// src/modules/Audio.js

import { Howl, Howler } from 'howler';

// ─── Constantes ───────────────────────────────────────────────────────────────

const AUDIO_BASE_URL = import.meta.env.BASE_URL;

const AUDIO_CHANNEL_PATHS = {
    bgm:   `${AUDIO_BASE_URL}assets/audio/bgm/`,
    voice: `${AUDIO_BASE_URL}assets/audio/voice/`,
    se:    `${AUDIO_BASE_URL}assets/audio/se/`,
};

/** Formatos en orden de preferencia — Howler elige el primero compatible */
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'ogg'];

const BGM_DUCK_FACTOR_VOICE  = 0.35; // BGM baja al 35% mientras habla un personaje
const BGM_DUCK_FACTOR_PAUSED = 0.20; // BGM baja al 20% al abrir el menú de pausa

const DUCK_FADE_VOICE_MS  = 220;
const DUCK_FADE_RESUME_MS = 400;
const DUCK_FADE_PAUSE_MS  = 300;
const BGM_STOP_FADE_MS    = 1000;

// ─── Typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'bgm' | 'voice' | 'se'} AudioChannel
 */

/**
 * @typedef {Object} ChannelVolumes
 * @property {number} bgm   - 0.0 a 1.0
 * @property {number} voice - 0.0 a 1.0
 * @property {number} se    - 0.0 a 1.0
 */

// ─── AudioManager ─────────────────────────────────────────────────────────────

/**
 * Gestor de audio del motor. Tres canales independientes: BGM, voz y efectos.
 *
 * Internamente usa Howler.js (Web Audio API con fallback a HTML5 Audio).
 * La API pública es idéntica hacia el Engine y el MenuSystem — ningún módulo
 * externo necesita saber que existe Howler.
 *
 * Canales:
 * - `bgm`   — música de fondo, loop continuo, soporta fade y ducking
 * - `voice` — voz del personaje activo, interrumpe la anterior al cambiar
 * - `se`    — efectos de sonido puntuales (one-shot), no interrumpen nada
 *
 * Ducking:
 * - Al reproducir voz: BGM baja al 35% con fade suave, sube al terminar
 * - Al pausar el juego: BGM baja al 20% con fade, sube al reanudar
 *
 * @example
 * const audio = new AudioManager();
 * audio.unlock(); // llamar tras el primer gesto del usuario
 * await audio.playBGM('track_01', 0.4);
 * await audio.playVoice('VAL_001.mp3');
 */
export class AudioManager {

    // ── Canal BGM ──────────────────────────────────────────────────────────

    /** @type {Howl|null} — instancia Howl activa del BGM actual */
    #activeBgmHowl = null;

    /** @type {string|null} — nombre de pista activa para evitar recargas */
    #activeBgmTrackName = null;

    /**
     * Volumen base del BGM sin ducking aplicado.
     * El ducking opera sobre este valor, no sobre el volumen actual.
     * @type {number}
     */
    #bgmBaseVolume = 0.5;

    // ── Canales de voz y efectos ───────────────────────────────────────────

    /** @type {Howl|null} */
    #activeVoiceHowl = null;

    /** @type {Howl|null} */
    #activeSeHowl = null;

    // ── Volúmenes por canal ────────────────────────────────────────────────

    /** @type {ChannelVolumes} */
    #channelVolumes = {
        bgm:   0.5,
        voice: 1.0,
        se:    0.8,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Desbloquea el contexto de audio del navegador.
     * Los navegadores modernos requieren un gesto del usuario antes de reproducir.
     * Llamar desde el handler del primer clic del jugador.
     */
    unlock() {
        // Howler gestiona el desbloqueo internamente — este método existe
        // para mantener compatibilidad con el contrato público anterior.
        // Una llamada explícita a Howler.ctx?.resume() cubre edge cases.
        Howler.ctx?.resume();
    }

    /**
     * Reproduce música de fondo en loop continuo.
     * Si la misma pista ya está sonando, no hace nada.
     * Si hay otra pista activa, la reemplaza inmediatamente.
     *
     * @param {string} trackName - Nombre del archivo sin extensión
     * @param {number} [volume]  - Volumen (0.0–1.0). Usa el valor del canal si no se pasa.
     */
    async playBGM(trackName, volume) {
        const targetVolume = volume ?? this.#channelVolumes.bgm;

        if (this.#activeBgmTrackName === trackName && this.#activeBgmHowl?.playing()) return;

        this.#stopBgmImmediately();

        this.#bgmBaseVolume     = targetVolume;
        this.#activeBgmTrackName = trackName;

        this.#activeBgmHowl = new Howl({
            src:    this.#buildSourceUrls(trackName, 'bgm'),
            volume: targetVolume,
            loop:   true,
            onloaderror: (id, error) => {
                console.error(`[Audio] BGM no encontrado: "${trackName}"`, error);
            },
        });

        this.#activeBgmHowl.play();
    }

    /**
     * Detiene el BGM con fade out gradual.
     * @param {number} [fadeDurationMs]
     */
    stopBGM(fadeDurationMs = BGM_STOP_FADE_MS) {
        if (!this.#activeBgmHowl?.playing()) return;
        this.#activeBgmHowl.fade(this.#activeBgmHowl.volume(), 0, fadeDurationMs);
        this.#activeBgmHowl.once('fade', () => {
            this.#activeBgmHowl?.stop();
            this.#activeBgmHowl     = null;
            this.#activeBgmTrackName = null;
        });
    }

    /**
     * Reproduce una línea de voz. Interrumpe cualquier voz anterior.
     * Al terminar, restaura el BGM al volumen base (unduck).
     *
     * @param {string} voiceFilename - Nombre del archivo con extensión (ej: 'VAL_001.mp3')
     */
    async playVoice(voiceFilename) {
        this.#activeVoiceHowl?.stop();

        const voicePath = `${AUDIO_CHANNEL_PATHS.voice}${voiceFilename}`;

        this.#activeVoiceHowl = new Howl({
            src:    [voicePath],
            volume: this.#channelVolumes.voice,
            onplay: () => this.#duckBgmForVoice(),
            onend:  () => this.#unduckBgmAfterVoice(),
            onstop: () => this.#unduckBgmAfterVoice(),
            onloaderror: (id, error) => {
                console.warn(`[Audio] Voz no encontrada: "${voiceFilename}"`, error);
            },
        });

        this.#activeVoiceHowl.play();
    }

    /**
     * Reproduce un efecto de sonido (one-shot).
     * No interrumpe el BGM ni la voz.
     *
     * @param {string} effectName - Nombre del archivo sin extensión
     * @param {number} [volume]   - Volumen específico para este efecto
     */
    async playSE(effectName, volume) {
        this.#activeSeHowl?.stop();

        this.#activeSeHowl = new Howl({
            src:    this.#buildSourceUrls(effectName, 'se'),
            volume: volume ?? this.#channelVolumes.se,
            onloaderror: (id, error) => {
                console.warn(`[Audio] Efecto no encontrado: "${effectName}"`, error);
            },
        });

        this.#activeSeHowl.play();
    }

    /**
     * Ajusta el volumen de un canal y lo aplica inmediatamente.
     * @param {AudioChannel} channel
     * @param {number}       volume  - 0.0 a 1.0
     */
    setVolume(channel, volume) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.#channelVolumes[channel] = clampedVolume;

        if (channel === 'bgm') {
            this.#bgmBaseVolume = clampedVolume;
            this.#activeBgmHowl?.volume(clampedVolume);
        }
        if (channel === 'voice') this.#activeVoiceHowl?.volume(clampedVolume);
        if (channel === 'se')    this.#activeSeHowl?.volume(clampedVolume);
    }

    /** Silencia todos los canales instantáneamente. */
    muteAll() {
        Howler.mute(true);
    }

    /** Restaura todos los canales tras un mute. */
    unmuteAll() {
        Howler.mute(false);
    }

    // ── Ducking de pausa ───────────────────────────────────────────────────

    /**
     * Baja el BGM al 20% al entrar en el menú de pausa.
     * Más pronunciado que el ducking de voz — indica una pausa activa.
     */
    pauseDuck() {
        if (!this.#activeBgmHowl?.playing()) return;
        const targetVolume = this.#bgmBaseVolume * BGM_DUCK_FACTOR_PAUSED;
        this.#activeBgmHowl.fade(this.#activeBgmHowl.volume(), targetVolume, DUCK_FADE_PAUSE_MS);
    }

    /** Restaura el BGM al salir del menú de pausa. */
    pauseUnduck() {
        if (!this.#activeBgmHowl?.playing()) return;
        this.#activeBgmHowl.fade(this.#activeBgmHowl.volume(), this.#bgmBaseVolume, DUCK_FADE_RESUME_MS);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DUCKING INTERNO — activado por eventos de voz
    // ─────────────────────────────────────────────────────────────────────────

    #duckBgmForVoice() {
        if (!this.#activeBgmHowl?.playing()) return;
        const targetVolume = this.#bgmBaseVolume * BGM_DUCK_FACTOR_VOICE;
        this.#activeBgmHowl.fade(this.#activeBgmHowl.volume(), targetVolume, DUCK_FADE_VOICE_MS);
    }

    #unduckBgmAfterVoice() {
        if (!this.#activeBgmHowl?.playing()) return;
        this.#activeBgmHowl.fade(this.#activeBgmHowl.volume(), this.#bgmBaseVolume, DUCK_FADE_RESUME_MS);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILIDADES PRIVADAS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Construye el array de URLs de fuente para Howler.
     * Howler elige automáticamente el primer formato compatible con el navegador.
     *
     * @param {string}       trackName
     * @param {AudioChannel} channel
     * @returns {string[]}
     */
    #buildSourceUrls(trackName, channel) {
        const basePath = `${AUDIO_CHANNEL_PATHS[channel]}${trackName}`;
        return SUPPORTED_AUDIO_FORMATS.map(format => `${basePath}.${format}`);
    }

    /** Detiene el BGM activo sin fade — para reemplazos inmediatos. */
    #stopBgmImmediately() {
        if (!this.#activeBgmHowl) return;
        this.#activeBgmHowl.stop();
        this.#activeBgmHowl.unload();
        this.#activeBgmHowl     = null;
        this.#activeBgmTrackName = null;
    }
}
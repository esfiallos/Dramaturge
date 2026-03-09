// src/modules/Audio.js
//
// CANALES DE AUDIO:
//   bgm   → Música de fondo. Loop continuo. Soporta fade out.
//   voice → Voz del personaje activo. Se interrumpe al cambiar de línea.
//   se    → Efectos de sonido puntuales (one-shot).
//
// Usa HTMLAudioElement (sin dependencias). Suficiente para novelas visuales.
// Si en el futuro necesitas audio posicional o síntesis, migrar a Web Audio API.

// Formatos de audio soportados en orden de preferencia.
const AUDIO_FORMATS = ['mp3', 'ogg'];

// Rutas base por canal.
// Si el param que viene del script ya empieza con '/', se usa directamente.
// Si no (ej: 'track_01'), se le añade el prefijo del canal.
const AUDIO_BASE = {
    bgm:   '/assets/audio/bgm/',
    voice: '/assets/audio/voice/',
    se:    '/assets/audio/se/',
};

/**
 * Resuelve la ruta de audio intentando múltiples formatos.
 * Devuelve la primera URL que el navegador puede reproducir,
 * o el path original si ya tiene extensión o ninguno funciona.
 * @param   {string} path
 * @returns {Promise<string>}
 */
/**
 * Resuelve la ruta de audio:
 *   1. Si el param ya es una ruta absoluta ('/assets/...'), se usa directo.
 *   2. Si no, se añade el prefijo del canal (bgm/voice/se).
 *   3. Si no tiene extensión, se prueba mp3 → ogg via HEAD request.
 * @param {string} param   - Valor del param del script ('.dan')
 * @param {string} channel - 'bgm' | 'voice' | 'se'
 */
async function resolveAudioPath(param, channel = 'bgm') {
    // Si ya es ruta absoluta, respetar tal cual
    const path = param.startsWith('/') ? param : `${AUDIO_BASE[channel]}${param}`;

    const hasExt = AUDIO_FORMATS.some(f => path.toLowerCase().endsWith(`.${f}`));
    if (hasExt) return path;

    for (const fmt of AUDIO_FORMATS) {
        const candidate = `${path}.${fmt}`;
        try {
            const res = await fetch(candidate, { method: 'HEAD' });
            if (res.ok) return candidate;
        } catch { /* continuar */ }
    }

    return `${path}.mp3`; // fallback
}

export class AudioManager {
    constructor() {
        // Cada canal es un HTMLAudioElement independiente
        this._bgm   = new Audio();
        this._voice = new Audio();
        this._se    = new Audio();

        this._bgm.loop = true;

        // Volúmenes por canal (0.0 → 1.0)
        this._volumes = {
            bgm:   0.5,
            voice: 1.0,
            se:    0.8,
        };

        this._bgmFadeTimer = null; // referencia al intervalo de fade activo
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Reproduce música de fondo en loop.
     * Si ya hay una pista activa, la reemplaza.
     * @param {string} path   - Ruta al archivo (ej: 'assets/audio/bgm/forest.mp3')
     * @param {number} volume - Volumen inicial (0.0–1.0). Usa el canal por defecto si no se pasa.
     */
    async playBGM(path, volume) {
        const resolved = await resolveAudioPath(path, 'bgm');
        if (this._bgm.src.endsWith(resolved) && !this._bgm.paused) return;

        this._cancelFade();
        this._bgm.src    = resolved;
        this._bgm.volume = volume ?? this._volumes.bgm;
        this._bgm.currentTime = 0;
        this._bgm.play().catch(e => console.warn(`[Audio] BGM: ${e.message} (${resolved})`));
    }

    /**
     * Detiene la BGM con fade out gradual.
     * @param {number} durationMs - Duración del fade en milisegundos.
     */
    stopBGM(durationMs = 1000) {
        if (this._bgm.paused) return;
        this._fadeOut(this._bgm, durationMs, () => {
            this._bgm.pause();
            this._bgm.currentTime = 0;
        });
    }

    /**
     * Reproduce la línea de voz de un personaje.
     * Interrumpe cualquier voz anterior automáticamente.
     * @param {string} path - Ruta al archivo (ej: 'assets/audio/voice/VAL_001.mp3')
     */
    async playVoice(path) {
        const resolved = await resolveAudioPath(path, 'voice');
        this._voice.pause();
        this._voice.src    = resolved;
        this._voice.volume = this._volumes.voice;
        this._voice.currentTime = 0;
        this._voice.play().catch(e => console.warn(`[Audio] Voz: ${e.message} (${resolved})`));
    }

    /**
     * Reproduce un efecto de sonido (one-shot).
     * No interrumpe ni la BGM ni la voz.
     * @param {string} path   - Ruta al archivo
     * @param {number} volume - Volumen específico para este SE
     */
    async playSE(path, volume) {
        const resolved = await resolveAudioPath(path, 'se');
        this._se.pause();
        this._se.src    = resolved;
        this._se.volume = volume ?? this._volumes.se;
        this._se.currentTime = 0;
        this._se.play().catch(e => console.warn(`[Audio] SE: ${e.message} (${resolved})`));
    }

    /**
     * Ajusta el volumen de un canal.
     * @param {'bgm'|'voice'|'se'} channel
     * @param {number}             value    - 0.0 a 1.0
     */
    setVolume(channel, value) {
        const clamped = Math.max(0, Math.min(1, value));
        this._volumes[channel] = clamped;

        // Aplicar inmediatamente al elemento activo
        if (channel === 'bgm')   this._bgm.volume   = clamped;
        if (channel === 'voice') this._voice.volume = clamped;
        if (channel === 'se')    this._se.volume    = clamped;
    }

    /** Silencia todos los canales instantáneamente. */
    muteAll() {
        this._bgm.muted   = true;
        this._voice.muted = true;
        this._se.muted    = true;
    }

    /** Restaura el audio después de un mute. */
    unmuteAll() {
        this._bgm.muted   = false;
        this._voice.muted = false;
        this._se.muted    = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DESBLOQUEO DE AUDIO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Desbloquea el contexto de audio del navegador.
     * Los navegadores modernos requieren un gesto del usuario antes de reproducir.
     * Llamar desde el handler del clic de "Nueva Partida" / "Continuar".
     */
    unlock() {
        // Reproducir y pausar inmediatamente un silencio — esto desbloquea el contexto
        const silent = new Audio();
        silent.play().catch(() => {}); // el catch es intencional
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Reduce el volumen de un elemento de audio gradualmente.
     * @param {HTMLAudioElement} audioEl
     * @param {number}           durationMs
     * @param {Function}         onComplete - Callback al finalizar
     */
    _fadeOut(audioEl, durationMs, onComplete) {
        this._cancelFade();
        const startVolume = audioEl.volume;
        const startTime   = performance.now();

        this._bgmFadeTimer = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const t       = Math.min(elapsed / durationMs, 1);
            audioEl.volume = startVolume * (1 - t);

            if (t >= 1) {
                this._cancelFade();
                onComplete?.();
            }
        }, 16); // ~60fps
    }

    _cancelFade() {
        if (this._bgmFadeTimer) {
            clearInterval(this._bgmFadeTimer);
            this._bgmFadeTimer = null;
        }
    }
}
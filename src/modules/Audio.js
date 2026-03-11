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
    bgm:   `${import.meta.env.BASE_URL}assets/audio/bgm/`,
    voice: `${import.meta.env.BASE_URL}assets/audio/voice/`,
    se:    `${import.meta.env.BASE_URL}assets/audio/se/`,
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
 * @param {string} param   - Valor del param del script ('.ems')
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

        // Ducking: cuando hay voz activa, el BGM baja al % definido
        this._bgmBaseVolume  = this._volumes.bgm; // volumen real sin duck
        this._duckFactor     = 0.35; // BGM baja al 35% mientras habla un personaje
        this._duckRafId      = null;

        // Restaurar BGM cuando la voz termina
        this._voice.addEventListener('ended', () => this._unduckBGM());
        this._voice.addEventListener('pause', () => {
            // Solo restaurar si fue pausa definitiva (src vacío = stop manual)
            if (!this._voice.src) this._unduckBGM();
        });
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
        this._bgmBaseVolume = volume ?? this._volumes.bgm;
        this._bgm.volume    = this._bgmBaseVolume;
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
        this._voice.play()
            .then(() => this._duckBGM()) // ducking solo si la voz arrancó bien
            .catch(e => console.warn(`[Audio] Voz: ${e.message} (${resolved})`));
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
        if (channel === 'bgm') {
            this._bgmBaseVolume = clamped; // actualizar base para ducking
            this._bgm.volume    = clamped;
        }
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

        const tick = () => {
            const t = Math.min((performance.now() - startTime) / durationMs, 1);
            // Ease-out para que el fade suene natural
            audioEl.volume = startVolume * (1 - (t * t));
            if (t < 1) {
                this._bgmFadeTimer = requestAnimationFrame(tick);
            } else {
                audioEl.volume = 0;
                this._bgmFadeTimer = null;
                onComplete?.();
            }
        };
        this._bgmFadeTimer = requestAnimationFrame(tick);
    }

    _cancelFade() {
        if (this._bgmFadeTimer) {
            cancelAnimationFrame(this._bgmFadeTimer);
            this._bgmFadeTimer = null;
        }
    }

    // ── Ducking helpers ───────────────────────────────────────────────────────

    /**
     * Duck suave al entrar en pausa — baja el BGM al 20% con ease-in.
     * Más pronunciado que el duck de voz porque es una pausa activa del usuario.
     */
    pauseDuck() {
        if (this._bgm.paused) return;
        cancelAnimationFrame(this._duckRafId);
        const startVol  = this._bgm.volume;
        const targetVol = this._bgmBaseVolume * 0.20;
        const durationMs = 300;
        const startTime  = performance.now();
        const tick = () => {
            const t = Math.min((performance.now() - startTime) / durationMs, 1);
            const ease = t * t; // ease-in — baja rápido al principio
            this._bgm.volume = startVol + (targetVol - startVol) * ease;
            if (t < 1) this._duckRafId = requestAnimationFrame(tick);
        };
        this._duckRafId = requestAnimationFrame(tick);
    }

    /** Restaura el BGM al salir de pausa — ease-out cúbico. */
    pauseUnduck() {
        if (this._bgm.paused) return;
        cancelAnimationFrame(this._duckRafId);
        const startVol   = this._bgm.volume;
        const targetVol  = this._bgmBaseVolume;
        const durationMs = 500;
        const startTime  = performance.now();
        const tick = () => {
            const t = Math.min((performance.now() - startTime) / durationMs, 1);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
            this._bgm.volume = startVol + (targetVol - startVol) * ease;
            if (t < 1) this._duckRafId = requestAnimationFrame(tick);
        };
        this._duckRafId = requestAnimationFrame(tick);
    }

    _duckBGM() {
        if (this._bgm.paused) return;
        cancelAnimationFrame(this._duckRafId);
        const startVol  = this._bgm.volume;
        const targetVol = this._bgmBaseVolume * this._duckFactor;
        const durationMs = 220;
        const startTime  = performance.now();

        const tick = () => {
            const t = Math.min((performance.now() - startTime) / durationMs, 1);
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            this._bgm.volume = startVol + (targetVol - startVol) * ease;
            if (t < 1) this._duckRafId = requestAnimationFrame(tick);
        };
        this._duckRafId = requestAnimationFrame(tick);
    }

    _unduckBGM() {
        if (this._bgm.paused) return;
        cancelAnimationFrame(this._duckRafId);
        const startVol   = this._bgm.volume;
        const targetVol  = this._bgmBaseVolume;
        const durationMs = 400;
        const startTime  = performance.now();

        const tick = () => {
            const t = Math.min((performance.now() - startTime) / durationMs, 1);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
            this._bgm.volume = startVol + (targetVol - startVol) * ease;
            if (t < 1) this._duckRafId = requestAnimationFrame(tick);
        };
        this._duckRafId = requestAnimationFrame(tick);
    }
}
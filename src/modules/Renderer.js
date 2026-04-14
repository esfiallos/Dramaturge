// src/modules/Renderer.js
//
// ARQUITECTURA DE CAPAS:
//   [PIXI Canvas]  → fondos y sprites (z-index: 5)
//   [DOM Overlay]  → textbox, nombre, UI (z-index: 30+)
//
// CICLO DE VIDA OBLIGATORIO (PixiJS v8):
//   const renderer = new Renderer();
//   await renderer.init();   ← debe llamarse antes de cualquier otro método

import { Application, Assets, Sprite, Container } from 'pixi.js';

// ─── Constantes de configuración ─────────────────────────────────────────────

/** Posición X normalizada (0–1) de cada slot de sprite en pantalla. */
const SPRITE_SLOT_POSITION_X = { left: 0.20, center: 0.50, right: 0.80 };

/**
 * Formatos de imagen probados en orden de preferencia.
 * Si el path ya tiene extensión conocida se intenta primero esa.
 */
const IMAGE_FORMATS = ['webp', 'png', 'jpg', 'jpeg'];

/** Altura máxima de un sprite como fracción de la pantalla. */
const SPRITE_HEIGHT_RATIO = 0.82;

/** Duración por defecto de transiciones de fade en ms. */
const FADE_MS = 500;

/** Intervalo en ms entre cada carácter del typewriter. */
const TYPEWRITER_CHAR_INTERVAL_MS = 28;

// ─── Helpers de módulo ────────────────────────────────────────────────────────

/**
 * Carga una textura probando todos los formatos en orden.
 *
 * PixiJS Assets necesita la extensión en la URL para seleccionar el parser
 * correcto. Estrategia:
 *   1. Si el path ya tiene extensión conocida → intentarla primero.
 *   2. Probar el resto de formatos con la ruta base (sin extensión).
 *
 * @param   {string} path - Con extensión ('v_idle.webp') o sin ('v_idle')
 * @returns {Promise<import('pixi.js').Texture|null>}
 */
async function loadTexture(path) {
    const detectedExtension = IMAGE_FORMATS.find(
        fmt => path.toLowerCase().endsWith(`.${fmt}`)
    );
    const pathWithoutExtension = detectedExtension
        ? path.slice(0, -(detectedExtension.length + 1))
        : path;

    const formatsToTry = detectedExtension
        ? [detectedExtension, ...IMAGE_FORMATS.filter(fmt => fmt !== detectedExtension)]
        : IMAGE_FORMATS;

    for (const imageFormat of formatsToTry) {
        try {
            return await Assets.load(`${pathWithoutExtension}.${imageFormat}`);
        } catch { /* continuar con el siguiente formato */ }
    }
    return null;
}

// ─── Clase principal ──────────────────────────────────────────────────────────

export class Renderer {

    // ── PixiJS ─────────────────────────────────────────────────────────────

    /** @type {import('pixi.js').Application} */
    app;

    /** @type {import('pixi.js').Container} */
    bgLayer;

    /** @type {import('pixi.js').Container} */
    spriteLayer;

    /** @type {import('pixi.js').Sprite|null} */
    bgCurrent = null;

    /** @type {Map<string, import('pixi.js').Sprite>} */
    activeSprites;

    // ── Elementos DOM públicos ──────────────────────────────────────────────
    // Accedidos directamente por Engine para actualizar el textbox.

    /** @type {HTMLElement} */
    nameEl;

    /** @type {HTMLElement} */
    textEl;

    /** @type {HTMLElement} */
    textBox;

    /** @type {HTMLElement} */
    transition;

    // ── Estado de transición de modo ────────────────────────────────────────

    /**
     * True mientras se está ejecutando una transición de modo (narración ↔ diálogo).
     * Engine respeta este flag en next() para no procesar input durante el fade.
     * @type {boolean}
     */
    isTransitioning = false;

    // ── Estado interno del typewriter ───────────────────────────────────────

    /** @type {number|null} — handle del requestAnimationFrame activo */
    #typewriterRafId = null;

    /** @type {string} — texto completo de la línea en curso */
    #typewriterFullText = '';

    /** @type {Function|null} — callback llamado al terminar de escribir */
    #typewriterCallback = null;

    /** @type {boolean} — true cuando el typewriter llegó al último carácter */
    #typewriterComplete = false;

    // ── Flags de modos de avance ────────────────────────────────────────────

    /**
     * Cuando está activo, el próximo typewriter completa el texto en un solo frame.
     * Se consume automáticamente — no persiste más de una llamada.
     * Activar vía activateInstantMode().
     * @type {boolean}
     */
    #instantModeActive = false;

    /**
     * Bloqueo post-skip: protege al jugador de avanzar involuntariamente
     * justo después de completar texto con el modo skip.
     * Leer vía getter isSkipLocked.
     * @type {boolean}
     */
    #skipLocked = false;

    // ── Elementos DOM internos (creados en init()) ──────────────────────────

    /** @type {HTMLElement|null} — indicador ▼ que parpadea al terminar la línea */
    #advanceIndicator = null;

    /** @type {HTMLElement|null} — overlay de fade DOM para transiciones de escena */
    #domFadeLayer = null;

    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        this.app           = new Application();
        this.activeSprites = new Map();

        this.nameEl     = document.getElementById('char-name');
        this.textEl     = document.getElementById('char-text');
        this.textBox    = document.getElementById('text-box');
        this.transition = document.getElementById('scene-transition');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA — Modos de avance
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Activa el modo de texto instantáneo para la próxima llamada a typewriter().
     * El Engine lo llama antes de instrucciones de texto en modo skip.
     * Se consume automáticamente — no persiste más de un uso.
     */
    activateInstantMode() {
        this.#instantModeActive = true;
    }

    /**
     * True si el skip-lock está activo.
     * El Engine lo consulta para ignorar el input durante el breve periodo
     * de protección post-skip.
     * @returns {boolean}
     */
    get isSkipLocked() {
        return this.#skipLocked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN (async — llamar una sola vez desde main.js)
    // ─────────────────────────────────────────────────────────────────────────

    async init() {
        const viewport = document.getElementById('viewport');

        await this.app.init({
            resizeTo:    viewport,
            background:  0x000000,
            antialias:   true,
            autoDensity: true,
            resolution:  window.devicePixelRatio || 1,
        });

        const canvas = this.app.canvas;
        canvas.style.cssText = 'position:absolute;inset:0;z-index:5;';

        const clickZone = viewport.querySelector('#click-zone');
        viewport.insertBefore(canvas, clickZone);

        this.bgLayer     = new Container();
        this.spriteLayer = new Container();
        this.app.stage.addChild(this.bgLayer, this.spriteLayer);

        this.app.renderer.on('resize', () => this.#onResize());

        // Indicador ▼ — parpadea cuando el typewriter termina y espera input
        this.#advanceIndicator = document.createElement('span');
        this.#advanceIndicator.id          = 'advance-indicator';
        this.#advanceIndicator.textContent = '▼';
        this.textBox?.appendChild(this.#advanceIndicator);

        // Overlay de fade DOM — cubre el viewport para transiciones de escena
        this.#domFadeLayer = document.createElement('div');
        this.#domFadeLayer.style.cssText = [
            'position:absolute', 'inset:0', 'z-index:25',
            'pointer-events:none', 'opacity:0',
            'transition:opacity 0ms linear',
            'background:#000',
        ].join(';');
        viewport.appendChild(this.#domFadeLayer);

        console.log('[Renderer] PixiJS v8 inicializado.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPRITES
    // ─────────────────────────────────────────────────────────────────────────

    async renderSprite(actor, path, slot, effect = 'fade') {
        this.#destroySprite(actor);

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] Sprite no encontrado en ningún formato: ${path}`);
            return;
        }

        const sprite       = new Sprite(texture);
        sprite._dramSlot   = slot;  // guardado para reposicionar en resize
        this.#positionSprite(sprite, slot);
        sprite.alpha = 0;
        this.spriteLayer.addChild(sprite);
        this.activeSprites.set(actor, sprite);

        if (effect === 'fade') {
            await this.#fadeIn(sprite);
        } else if (effect === 'slide') {
            sprite.y += 50;
            await Promise.all([
                this.#fadeIn(sprite),
                this.#moveTo(sprite, sprite.x, sprite.y - 50),
            ]);
        } else {
            sprite.alpha = 1;
        }
    }

    async hideSprite(actor, slot, effect = 'fade') {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;

        if (effect === 'fade') await this.#fadeOut(sprite);
        this.#destroySprite(actor);
    }

    async updateSprite(actor, path) {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] Sprite no encontrado en updateSprite: ${path}`);
            return;
        }

        sprite.texture = texture;
        const targetH  = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FONDO
    // ─────────────────────────────────────────────────────────────────────────

    async changeBackground(target, effect = 'fade', time = '1s') {
        const durationMs = this.#parseTime(time);
        const path       = `${import.meta.env.BASE_URL}assets/bg/${target}`;

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] Fondo no encontrado en ningún formato: ${path}`);
            return;
        }

        const newBg    = new Sprite(texture);
        newBg.alpha    = 0;
        newBg.width    = this.app.screen.width;
        newBg.height   = this.app.screen.height;
        this.bgLayer.addChild(newBg);

        if (effect === 'fade') {
            await this.#fadeIn(newBg, durationMs);
        } else {
            newBg.alpha = 1;
        }

        if (this.bgCurrent) this.bgCurrent.destroy();
        this.bgCurrent = newBg;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIÁLOGO / TYPEWRITER
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Inicia el efecto typewriter para una línea de diálogo o narración.
     *
     * @param {string|null} name   - Nombre del personaje, o null para narración
     * @param {string}      text   - Texto completo a escribir
     * @param {Function}    onDone - Llamado cuando el jugador puede avanzar
     */
    async typewriter(name, text, onDone) {
        this.#typewriterFullText = text;
        this.#typewriterCallback = onDone;
        this.#typewriterComplete = false;
        this.#skipLocked         = false;

        const isNarration = !name;

        this.#setAdvance(false);

        // Limpiar texto antes del crossfade — el swap ocurre mientras la caja
        // está invisible, cubriendo todos los casos de transición de modo.
        this.nameEl.innerText = '';
        this.textEl.innerText = '';

        await this.applyNarrationMode(isNarration);

        this.nameEl.innerText = isNarration ? '' : name;

        // Modo instantáneo (skip): completar sin animación
        if (this.#instantModeActive) {
            this.#instantModeActive  = false; // consumir el flag
            this.textEl.innerText    = text;
            this.#typewriterComplete = true;
            this.#setAdvance(false);          // en skip no se muestra el ▼
            this.#typewriterCallback?.();
            return;
        }

        // rAF typewriter — velocidad consistente independiente del hardware.
        // Acumula tiempo real y emite un carácter cada TYPEWRITER_CHAR_INTERVAL_MS.
        let charIndex  = 0;
        let lastTime   = null;
        let accumulated = 0;

        cancelAnimationFrame(this.#typewriterRafId);
        this.#typewriterRafId = null;

        const tick = (now) => {
            if (lastTime === null) lastTime = now;
            accumulated += now - lastTime;
            lastTime = now;

            while (accumulated >= TYPEWRITER_CHAR_INTERVAL_MS && charIndex < text.length) {
                this.textEl.append(text.charAt(charIndex++));
                accumulated -= TYPEWRITER_CHAR_INTERVAL_MS;
            }

            if (charIndex < text.length) {
                this.#typewriterRafId = requestAnimationFrame(tick);
            } else {
                this.#typewriterRafId    = null;
                this.#typewriterComplete = true;
                this.#setAdvance(true);
                this.#typewriterCallback?.();
            }
        };

        this.#typewriterRafId = requestAnimationFrame(tick);
    }

    /**
     * Completa el texto instantáneamente si el typewriter está en curso.
     * No hace nada si ya terminó. Aplica un skip-lock breve para evitar
     * que el jugador avance dos pasos con un doble clic rápido.
     */
    skipTypewriter() {
        if (this.#typewriterComplete) return;

        cancelAnimationFrame(this.#typewriterRafId);
        this.#typewriterRafId    = null;
        this.textEl.innerText    = this.#typewriterFullText;
        this.#typewriterComplete = true;
        this.#skipLocked         = true;

        this.#setAdvance(true);
        setTimeout(() => { this.#skipLocked = false; }, 180);

        this.#typewriterCallback?.();
    }

    /**
     * Pulso visual en el textbox al intentar avanzar mientras el texto escribe.
     * Señal sutil de "espera, estoy escribiendo".
     */
    flashTextBox() {
        if (!this.textBox) return;
        this.textBox.classList.remove('click-flash');
        void this.textBox.offsetWidth;  // forzar reflow para reiniciar animación
        this.textBox.classList.add('click-flash');
        setTimeout(() => this.textBox.classList.remove('click-flash'), 150);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIMPIEZA DE ESCENA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Vacía sprites, fondo y textbox sin destruir la app PixiJS.
     * Llamado por Engine.reset() al iniciar una partida nueva.
     */
    clearScene() {
        for (const sprite of this.activeSprites.values()) {
            sprite.destroy({ texture: false });
        }
        this.activeSprites.clear();

        if (this.bgCurrent) {
            this.bgCurrent.destroy({ texture: false });
            this.bgCurrent = null;
        }

        if (this.nameEl) this.nameEl.innerText = '';
        if (this.textEl) this.textEl.innerText = '';
        this.#setAdvance(false);

        cancelAnimationFrame(this.#typewriterRafId);
        this.#typewriterRafId    = null;
        this.#typewriterComplete = false;
        this.#typewriterFullText = '';
        this.#typewriterCallback = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MODOS DE TEXTBOX
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Aplica el modo visual de narración o diálogo al textbox.
     * Llamado desde typewriter() en cada línea, y desde Engine.resumeFromState()
     * para restaurar el modo visual al cargar una partida.
     *
     * @param {boolean} active - true = narración, false = diálogo
     */
    applyNarrationMode(active) {
        this.textBox.classList.toggle('narration-mode', active);
        if (active) {
            this.#tweenSpriteAlpha(0.15, 200);
        } else {
            this.#tweenSpriteAlpha(1, 200);
        }
    }

    /**
     * Transición de modo narrador ↔ diálogo con crossfade.
     *
     * Cuando el modo CAMBIA:
     *   1. Fade a negro (rápido)
     *   2. Swap de clase y alpha de sprites (invisible para el jugador)
     *   3. Fade-out del negro en background — el typewriter arranca solapado
     *
     * Si el modo NO cambia, resuelve inmediatamente sin efectos.
     *
     * @param {boolean} toNarration - true = vamos a narración
     * @param {number}  fadeMs      - duración del fade in/out en ms
     * @returns {Promise<void>}
     */
    async modeTransition(toNarration, fadeMs = 140) {
        const alreadyNarration = this.textBox.classList.contains('narration-mode');
        if (alreadyNarration === toNarration) return;

        const overlay = this.transition;
        if (!overlay) return;

        this.isTransitioning = true;

        overlay.style.background = '#000000';
        overlay.style.transition = `opacity ${fadeMs}ms ease-in`;
        overlay.classList.add('active');

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                setTimeout(resolve, fadeMs);
            });
        });

        // Pantalla en negro — preparar todo de golpe
        cancelAnimationFrame(this.#typewriterRafId);
        this.#typewriterRafId = null;
        if (this.textEl) this.textEl.innerText = '';
        if (this.nameEl) this.nameEl.innerText = '';
        this.#setAdvance(false);

        this.textBox.classList.toggle('narration-mode', toNarration);

        const targetAlpha = toNarration ? 0.15 : 1;
        this.#tweenSpriteAlpha(targetAlpha, fadeMs * 2);

        // Fade-out en background — el typewriter arranca solapado con el reveal
        overlay.style.transition = `opacity ${fadeMs * 1.8}ms ease-out`;
        requestAnimationFrame(() => { overlay.style.opacity = '0'; });

        setTimeout(() => {
            overlay.classList.remove('active');
            overlay.style.transition = '';
            overlay.style.background = '';
        }, fadeMs * 1.8 + 20);

        this.isTransitioning = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSICIÓN DE ESCENA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fade fullscreen entre escenas. Llamado desde SceneManager.
     *
     * @param {'black'|'white'} color
     * @param {number}          ms    - duración de cada mitad
     * @returns {Promise<void>}
     */
    async sceneTransition(color = 'black', ms = 500) {
        const overlay = this.transition;
        if (!overlay) return;

        overlay.style.background = color === 'white' ? '#fff' : '#000';
        overlay.style.transition = `opacity ${ms}ms ease`;
        overlay.classList.add('active');

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                setTimeout(resolve, ms);
            });
        });

        await new Promise(r => setTimeout(r, 80));

        overlay.style.opacity = '0';
        await new Promise(r => setTimeout(r, ms));

        overlay.classList.remove('active');
        overlay.style.transition = '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILIDADES DE CURSOR
    // ─────────────────────────────────────────────────────────────────────────

    /** @param {'ready' | 'wait' | 'typing'} state */
    setCursorState(state) {
        const zone = document.getElementById('click-zone');
        if (!zone) return;
        if (state === 'wait') {
            zone.style.cursor        = 'default';
            zone.style.pointerEvents = 'none';
        } else {
            zone.style.cursor        = 'pointer';
            zone.style.pointerEvents = '';
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EFECTOS DE PANTALLA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sacude el stage lateralmente durante la duración indicada.
     * Bloquea hasta que termina.
     * @param {number} durationMs
     * @returns {Promise<void>}
     */
    fxShake(durationMs) {
        return new Promise(resolve => {
            const stage     = this.app.stage;
            const originX   = stage.x;
            const originY   = stage.y;
            const intensity = 8;
            const start     = performance.now();

            const tick = () => {
                const elapsed  = performance.now() - start;
                const progress = Math.min(elapsed / durationMs, 1);
                const decay    = 1 - progress;
                const amplitude = intensity * decay;

                stage.x = originX + (Math.random() * 2 - 1) * amplitude;
                stage.y = originY + (Math.random() * 2 - 1) * amplitude * 0.5;

                if (progress >= 1) {
                    stage.x = originX;
                    stage.y = originY;
                    this.app.ticker.remove(tick);
                    resolve();
                }
            };

            this.app.ticker.add(tick);
        });
    }

    /**
     * Destello de color sobre toda la pantalla. Divide la duración en
     * fade-in y fade-out iguales. Bloquea hasta que desaparece.
     *
     * @param {'white'|'black'} color
     * @param {number}          durationMs - ciclo completo (in + out)
     * @returns {Promise<void>}
     */
    fxFlash(color, durationMs) {
        return new Promise(resolve => {
            let overlay = document.getElementById('fx-flash-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'fx-flash-overlay';
                Object.assign(overlay.style, {
                    position:      'absolute',
                    inset:         '0',
                    zIndex:        '20',
                    pointerEvents: 'none',
                    opacity:       '0',
                });
                document.getElementById('viewport')?.appendChild(overlay);
            }

            const halfMs = durationMs / 2;

            overlay.style.background = color === 'white' ? '#ffffff' : '#000000';
            overlay.style.transition = `opacity ${halfMs}ms ease`;
            overlay.style.opacity    = '0';

            void overlay.offsetHeight;

            overlay.style.opacity = '1';

            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => resolve(), halfMs);
            }, halfMs);
        });
    }

    /**
     * Activa o desactiva una viñeta (oscurecimiento de bordes) sobre el canvas.
     * No bloquea — la siguiente instrucción se ejecuta de inmediato.
     * @param {boolean} active
     */
    fxVignette(active) {
        let vignette = document.getElementById('fx-vignette-overlay');

        if (!vignette) {
            vignette = document.createElement('div');
            vignette.id = 'fx-vignette-overlay';
            Object.assign(vignette.style, {
                position:      'absolute',
                inset:         '0',
                zIndex:        '15',
                pointerEvents: 'none',
                background:    'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.72) 100%)',
                opacity:       '0',
                transition:    'opacity 0.5s ease',
            });
            document.getElementById('viewport')?.appendChild(vignette);
        }

        vignette.style.opacity = active ? '1' : '0';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    /** @param {import('pixi.js').Sprite} sprite @param {string} slot */
    #positionSprite(sprite, slot) {
        sprite.anchor.set(0.5, 1.0);
        sprite.x = this.app.screen.width  * (SPRITE_SLOT_POSITION_X[slot] ?? 0.5);
        sprite.y = this.app.screen.height;

        const targetH = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    /** @param {string} actor */
    #destroySprite(actor) {
        const existing = this.activeSprites.get(actor);
        if (existing) {
            existing.destroy({ texture: false });
            this.activeSprites.delete(actor);
        }
    }

    #onResize() {
        const screenWidth  = this.app.screen.width;
        const screenHeight = this.app.screen.height;

        if (this.bgCurrent) {
            this.bgCurrent.width  = screenWidth;
            this.bgCurrent.height = screenHeight;
        }

        for (const [, sprite] of this.activeSprites) {
            const slot = sprite._dramSlot;
            if (slot) this.#positionSprite(sprite, slot);
        }
    }

    /**
     * @param {string|number} value - '2s', '500ms', '1.5s', o número en ms
     * @returns {number} — milisegundos
     */
    #parseTime(value) {
        if (typeof value === 'number') return value;
        if (value.endsWith('ms')) return parseInt(value);
        return parseFloat(value) * 1000;
    }

    /** @param {boolean} visible */
    #setAdvance(visible) {
        if (!this.#advanceIndicator) return;
        this.#advanceIndicator.classList.toggle('visible', visible);
    }

    /**
     * Anima el alpha de spriteLayer hacia un valor destino.
     * @param {number} target  - 0.0–1.0
     * @param {number} ms      - duración en ms
     */
    #tweenSpriteAlpha(target, ms) {
        const start     = this.spriteLayer.alpha;
        const delta     = target - start;
        const startTime = performance.now();

        const tick = (now) => {
            const progress = Math.min((now - startTime) / ms, 1);
            const ease     = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;
            this.spriteLayer.alpha = start + delta * ease;
            if (progress < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
    }

    /**
     * @param {object} pixiObject - Sprite u objeto PixiJS con propiedad alpha
     * @param {number} [durationMs]
     * @returns {Promise<void>}
     */
    #fadeIn(pixiObject, durationMs = FADE_MS) {
        return new Promise(resolve => {
            pixiObject.alpha = 0;
            const start = performance.now();
            const tick  = () => {
                const progress    = Math.min((performance.now() - start) / durationMs, 1);
                pixiObject.alpha  = progress;
                if (progress >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * @param {object} pixiObject
     * @param {number} [durationMs]
     * @returns {Promise<void>}
     */
    #fadeOut(pixiObject, durationMs = FADE_MS) {
        return new Promise(resolve => {
            const startAlpha = pixiObject.alpha;
            const start      = performance.now();
            const tick       = () => {
                const progress   = Math.min((performance.now() - start) / durationMs, 1);
                pixiObject.alpha = startAlpha * (1 - progress);
                if (progress >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * Ease-out cúbico — movimientos naturales, no mecánicos.
     * @param {object} pixiObject
     * @param {number} targetX
     * @param {number} targetY
     * @param {number} [durationMs]
     * @returns {Promise<void>}
     */
    #moveTo(pixiObject, targetX, targetY, durationMs = FADE_MS) {
        return new Promise(resolve => {
            const startX = pixiObject.x;
            const startY = pixiObject.y;
            const start  = performance.now();
            const tick   = () => {
                const progress = Math.min((performance.now() - start) / durationMs, 1);
                const ease     = 1 - Math.pow(1 - progress, 3);
                pixiObject.x   = startX + (targetX - startX) * ease;
                pixiObject.y   = startY + (targetY - startY) * ease;
                if (progress >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }
}
// src/modules/Renderer.js
//
// ARQUITECTURA DE CAPAS:
//   [PixiJS canvas]  → fondos y sprites        (z-index 5)
//   [DOM overlays]   → flash, viñeta, textbox  (z-index 15-30+)
//
// REGLA DE ANIMACIONES — tres casos, sin excepciones:
//   Objeto PixiJS (sprite, fondo, stage, capa)  → app.ticker.add(tick)
//   Elemento DOM con transición                  → element.animate().finished  [WAAPI]
//   Texto carácter a carácter                   → requestAnimationFrame
//
// Esta regla define dónde va cada efecto nuevo. No hay un cuarto caso.
//
// CICLO DE VIDA:
//   const renderer = new Renderer();
//   await renderer.init();   ← todos los overlays DOM se crean aquí, no lazy
//
// API PÚBLICA HACIA ENGINE:
//   activateInstantMode()   → Engine llama antes de texto en modo skip
//   get isSkipLocked        → Engine consulta para proteger el avance
//   applyNarrationMode(on)  → Engine llama al restaurar estado desde save

import { Application, Assets, Sprite, Container } from 'pixi.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Posición X normalizada de cada slot de sprite en pantalla. */
const SLOT_X = Object.freeze({ left: 0.20, center: 0.50, right: 0.80 });

/** Formatos de imagen probados en orden de preferencia. */
const IMAGE_FORMATS = ['webp', 'png', 'jpg', 'jpeg'];

/** Altura máxima de un sprite como fracción de la pantalla. */
const SPRITE_HEIGHT_RATIO = 0.82;

/** Ms entre caracteres en el typewriter. */
const TYPEWRITER_CHAR_MS = 28;

/** Duración por defecto de fades PixiJS en ms. */
const FADE_MS = 500;

/**
 * Curvas de easing centralizadas.
 *
 * Usadas por todos los métodos de animación — cambiar aquí afecta
 * a todos los efectos del motor de forma coherente.
 *
 * Formato: string CSS cubic-bezier compatible con WAAPI y documentado
 * con su nombre semántico para que los colaboradores entiendan la intención.
 *
 * Para animaciones PixiJS (Ticker), las curvas equivalentes están
 * implementadas como funciones en #applyEase().
 */
const EASING = Object.freeze({
    linear:    'linear',
    easeIn:    'cubic-bezier(0.4, 0, 1, 1)',      // aceleración suave — entradas
    easeOut:   'cubic-bezier(0, 0, 0.2, 1)',      // desaceleración suave — salidas, movimiento natural
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',    // simétrico — fundidos de modo
    snap:      'cubic-bezier(0.4, 0, 0.6, 1)',    // rápido al inicio, suave al final — flashes
});

// ─── Helpers de módulo ────────────────────────────────────────────────────────

/**
 * Carga una textura probando formatos en orden de preferencia.
 * Si el path ya tiene extensión conocida, la intenta primero.
 *
 * PixiJS Assets necesita extensión explícita para seleccionar el parser correcto.
 *
 * @param   {string} path — con o sin extensión ('v_idle.webp' | 'v_idle')
 * @returns {Promise<import('pixi.js').Texture|null>}
 */
async function loadTexture(path) {
    const existingExt = IMAGE_FORMATS.find(f => path.toLowerCase().endsWith(`.${f}`));
    const base        = existingExt ? path.slice(0, -(existingExt.length + 1)) : path;
    const order       = existingExt
        ? [existingExt, ...IMAGE_FORMATS.filter(f => f !== existingExt)]
        : IMAGE_FORMATS;

    for (const fmt of order) {
        try { return await Assets.load(`${base}.${fmt}`); }
        catch { /* continuar con el siguiente formato */ }
    }
    return null;
}

/**
 * Aplica una curva de easing a un valor t normalizado (0–1) para animaciones Ticker.
 * Equivalente a las curvas de EASING pero como función matemática.
 *
 * @param {number} t       — progreso normalizado 0–1
 * @param {string} easing  — nombre de clave de EASING
 * @returns {number}       — valor eased 0–1
 */
function applyEase(t, easing = 'easeOut') {
    switch (easing) {
        case 'linear':    return t;
        case 'easeIn':    return t * t;
        case 'easeOut':   return 1 - Math.pow(1 - t, 3);       // cubic ease-out
        case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        case 'snap':      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        default:          return t;
    }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class Renderer {

    // ── PixiJS — públicos ──────────────────────────────────────────────────

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

    // ── DOM — públicos (Engine actualiza textbox directamente) ────────────

    /** @type {HTMLElement} */ nameEl;
    /** @type {HTMLElement} */ textEl;
    /** @type {HTMLElement} */ textBox;
    /** @type {HTMLElement} */ transition;

    // ── Estado de transición — público ────────────────────────────────────

    /**
     * True mientras se ejecuta una transición de modo (narración ↔ diálogo).
     * Engine no procesa input mientras sea true.
     * @type {boolean}
     */
    isTransitioning = false;

    // ── Typewriter — privado ───────────────────────────────────────────────

    /** @type {number|null} */
    #twRafId = null;

    /** @type {string} */
    #twFullText = '';

    /** @type {Function|null} */
    #twCallback = null;

    /** @type {boolean} */
    #twComplete = false;

    // ── Modos de avance — privados, expuestos por API ─────────────────────

    /**
     * Cuando está activo, el próximo typewriter completa en un frame.
     * Activar via activateInstantMode(). Se consume automáticamente.
     * @type {boolean}
     */
    #instantModeActive = false;

    /**
     * Bloqueo post-skip. Leer via getter isSkipLocked.
     * @type {boolean}
     */
    #skipLocked = false;

    // ── Elementos DOM — todos creados en init(), no lazy ──────────────────
    //
    // REGLA: ningún método crea elementos DOM en su primera llamada.
    //        Todos los overlays existen desde init() y se reutilizan.

    /** @type {HTMLElement|null} */
    #advanceIndicator = null;

    /** @type {HTMLElement|null} — overlay para fxFlash */
    #flashOverlay = null;

    /** @type {HTMLElement|null} — overlay para fxVignette */
    #vignetteOverlay = null;

    constructor() {
        this.app           = new Application();
        this.activeSprites = new Map();
        this.nameEl     = document.getElementById('char-name');
        this.textEl     = document.getElementById('char-text');
        this.textBox    = document.getElementById('text-box');
        this.transition = document.getElementById('scene-transition');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN
    // Todos los elementos DOM y overlays se crean aquí — nunca en el primer uso.
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
        viewport.insertBefore(canvas, viewport.querySelector('#click-zone'));

        this.bgLayer     = new Container();
        this.spriteLayer = new Container();
        this.app.stage.addChild(this.bgLayer, this.spriteLayer);

        this.app.renderer.on('resize', () => this.#onResize());

        // Indicador ▼ — parpadea cuando el typewriter termina
        this.#advanceIndicator = document.createElement('span');
        this.#advanceIndicator.id          = 'advance-indicator';
        this.#advanceIndicator.textContent = '▼';
        this.textBox?.appendChild(this.#advanceIndicator);

        // Overlay de flash — creado aquí, reutilizado en cada fxFlash()
        this.#flashOverlay = document.createElement('div');
        this.#flashOverlay.id = 'fx-flash-overlay';
        Object.assign(this.#flashOverlay.style, {
            position:      'absolute',
            inset:         '0',
            zIndex:        '20',
            pointerEvents: 'none',
            opacity:       '0',
            background:    '#000000',
        });
        viewport.appendChild(this.#flashOverlay);

        // Overlay de viñeta — creado aquí, reutilizado en cada fxVignette()
        this.#vignetteOverlay = document.createElement('div');
        this.#vignetteOverlay.id = 'fx-vignette-overlay';
        Object.assign(this.#vignetteOverlay.style, {
            position:      'absolute',
            inset:         '0',
            zIndex:        '15',
            pointerEvents: 'none',
            opacity:       '0',
            background:    'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.72) 100%)',
        });
        viewport.appendChild(this.#vignetteOverlay);

        console.log('[Renderer] PixiJS v8 inicializado.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA — modos de avance
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Activa el modo de texto instantáneo para la próxima llamada a typewriter().
     * Engine lo llama antes de instrucciones de texto en modo skip.
     * Se consume automáticamente — no persiste más de un uso.
     */
    activateInstantMode() {
        this.#instantModeActive = true;
    }

    /**
     * True si el skip-lock está activo. Engine lo consulta en next().
     * @returns {boolean}
     */
    get isSkipLocked() {
        return this.#skipLocked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPRITES — Ticker (objetos PixiJS)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {string} actor
     * @param {string} path
     * @param {string} slot   — 'left' | 'center' | 'right'
     * @param {string} effect — 'fade' | 'slide' | cualquier otro = instantáneo
     */
    async renderSprite(actor, path, slot, effect = 'fade') {
        this.#destroySprite(actor);

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] Sprite no encontrado: ${path}`);
            return;
        }

        const sprite     = new Sprite(texture);
        sprite._dramSlot = slot;
        this.#positionSprite(sprite, slot);
        sprite.alpha = 0;
        this.spriteLayer.addChild(sprite);
        this.activeSprites.set(actor, sprite);

        if (effect === 'fade') {
            await this.#tickerFadeIn(sprite);
        } else if (effect === 'slide') {
            sprite.y += 50;
            await Promise.all([
                this.#tickerFadeIn(sprite),
                this.#tickerMoveTo(sprite, sprite.x, sprite.y - 50),
            ]);
        } else {
            sprite.alpha = 1;
        }
    }

    /**
     * @param {string} actor
     * @param {string} slot
     * @param {string} [effect]
     */
    async hideSprite(actor, slot, effect = 'fade') {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;
        if (effect === 'fade') await this.#tickerFadeOut(sprite);
        this.#destroySprite(actor);
    }

    /**
     * Cambia la textura de un sprite activo (cambio de pose).
     * @param {string} actor
     * @param {string} path
     */
    async updateSprite(actor, path) {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] updateSprite: no encontrado ${path}`);
            return;
        }
        sprite.texture = texture;
        const targetH  = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FONDO — Ticker (objeto PixiJS)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {string}        target  — nombre sin extensión en /assets/bg/
     * @param {string}        [effect]
     * @param {string|number} [time]
     */
    async changeBackground(target, effect = 'fade', time = '1s') {
        const ms      = this.#parseTime(time);
        const path    = `${import.meta.env.BASE_URL}assets/bg/${target}`;
        const texture = await loadTexture(path);

        if (!texture) {
            console.warn(`[Renderer] Fondo no encontrado: ${path}`);
            return;
        }

        const newBg    = new Sprite(texture);
        newBg.alpha    = 0;
        newBg.width    = this.app.screen.width;
        newBg.height   = this.app.screen.height;
        this.bgLayer.addChild(newBg);

        if (effect === 'fade') await this.#tickerFadeIn(newBg, ms);
        else newBg.alpha = 1;

        if (this.bgCurrent) this.bgCurrent.destroy();
        this.bgCurrent = newBg;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TYPEWRITER — rAF (texto carácter a carácter)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {string|null} name   — nombre del personaje, null para narración
     * @param {string}      text
     * @param {Function}    onDone
     */
    async typewriter(name, text, onDone) {
        this.#twFullText = text;
        this.#twCallback = onDone;
        this.#twComplete = false;
        this.#skipLocked  = false;

        const isNarration = !name;
        this.#setAdvance(false);
        this.nameEl.innerText = '';
        this.textEl.innerText = '';

        await this.applyNarrationMode(isNarration);
        this.nameEl.innerText = isNarration ? '' : name;

        if (this.#instantModeActive) {
            this.#instantModeActive = false;
            this.textEl.innerText   = text;
            this.#twComplete        = true;
            this.#setAdvance(false);
            this.#twCallback?.();
            return;
        }

        let charIndex  = 0;
        let lastTime   = null;
        let accumulated = 0;

        cancelAnimationFrame(this.#twRafId);

        const tick = (now) => {
            if (lastTime === null) lastTime = now;
            accumulated += now - lastTime;
            lastTime = now;

            while (accumulated >= TYPEWRITER_CHAR_MS && charIndex < text.length) {
                this.textEl.append(text.charAt(charIndex++));
                accumulated -= TYPEWRITER_CHAR_MS;
            }

            if (charIndex < text.length) {
                this.#twRafId = requestAnimationFrame(tick);
            } else {
                this.#twRafId    = null;
                this.#twComplete = true;
                this.#setAdvance(true);
                this.#twCallback?.();
            }
        };

        this.#twRafId = requestAnimationFrame(tick);
    }

    /**
     * Completa el typewriter instantáneamente con skip-lock breve.
     */
    skipTypewriter() {
        if (this.#twComplete) return;
        cancelAnimationFrame(this.#twRafId);
        this.#twRafId         = null;
        this.textEl.innerText = this.#twFullText;
        this.#twComplete      = true;
        this.#skipLocked      = true;
        this.#setAdvance(true);
        setTimeout(() => { this.#skipLocked = false; }, 180);
        this.#twCallback?.();
    }

    /**
     * Pulso visual en el textbox al intentar avanzar mientras el texto escribe.
     */
    flashTextBox() {
        if (!this.textBox) return;
        this.textBox.classList.remove('click-flash');
        void this.textBox.offsetWidth;
        this.textBox.classList.add('click-flash');
        setTimeout(() => this.textBox.classList.remove('click-flash'), 150);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MODOS DE TEXTBOX
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Aplica el modo visual narración / diálogo.
     * Llamado desde typewriter() y desde Engine.resumeFromState().
     *
     * spriteLayer.alpha se anima con el Ticker — es un objeto PixiJS.
     *
     * @param {boolean} active — true = narración, false = diálogo
     */
    applyNarrationMode(active) {
        this.textBox.classList.toggle('narration-mode', active);
        this.#tickerTweenAlpha(this.spriteLayer, active ? 0.15 : 1, 200);
    }

    /**
     * Transición con crossfade entre modo narración y diálogo.
     * Usa WAAPI para el overlay DOM. El spriteLayer usa el Ticker.
     *
     * @param {boolean} toNarration
     * @param {number}  [fadeMs]
     */
    async modeTransition(toNarration, fadeMs = 140) {
        const already = this.textBox.classList.contains('narration-mode');
        if (already === toNarration) return;

        const overlay = this.transition;
        if (!overlay) return;

        this.isTransitioning = true;

        // ── Fase 1: Fade a negro — WAAPI (overlay DOM) ────────────────────
        await overlay.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: fadeMs, easing: EASING.easeIn, fill: 'forwards' }
        ).finished;

        // ── Pantalla en negro: preparar todo de golpe ──────────────────────
        cancelAnimationFrame(this.#twRafId);
        this.#twRafId = null;
        if (this.textEl) this.textEl.innerText = '';
        if (this.nameEl) this.nameEl.innerText = '';
        this.#setAdvance(false);

        this.textBox.classList.toggle('narration-mode', toNarration);

        // spriteLayer es un objeto PixiJS — usa el Ticker
        this.#tickerTweenAlpha(this.spriteLayer, toNarration ? 0.15 : 1, fadeMs * 2);

        // ── Fase 2: Fade-out en background — WAAPI, sin await ─────────────
        // El typewriter arranca solapado con el reveal — sensación de una acción.
        overlay.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: fadeMs * 1.8, easing: EASING.easeOut, fill: 'forwards' }
        );

        this.isTransitioning = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSICIÓN DE ESCENA — WAAPI (overlay DOM)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fade fullscreen entre escenas.
     * @param {'black'|'white'} color
     * @param {number}          ms — duración de cada mitad
     */
    async sceneTransition(color = 'black', ms = 500) {
        const overlay = this.transition;
        if (!overlay) return;

        overlay.style.background = color === 'white' ? '#fff' : '#000';

        await overlay.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: ms, easing: EASING.easeIn, fill: 'forwards' }
        ).finished;

        // Pausa breve en color sólido — corte narrativo perceptible
        await new Promise(r => setTimeout(r, 80));

        await overlay.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: ms, easing: EASING.easeOut, fill: 'forwards' }
        ).finished;

        // Limpiar fill: 'forwards' para no dejar estilos inline residuales
        overlay.style.opacity = '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EFECTOS DE PANTALLA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sacude el stage lateralmente.
     * Stage es un objeto PixiJS — usa el Ticker.
     * Bloquea hasta que termina.
     *
     * @param {number} durationMs
     */
    fxShake(durationMs) {
        return new Promise(resolve => {
            const stage     = this.app.stage;
            const originX   = stage.x;
            const originY   = stage.y;
            const intensity = 8;
            const start     = performance.now();

            const tick = () => {
                const t   = Math.min((performance.now() - start) / durationMs, 1);
                const amp = intensity * (1 - t); // decay lineal

                stage.x = originX + (Math.random() * 2 - 1) * amp;
                stage.y = originY + (Math.random() * 2 - 1) * amp * 0.5;

                if (t >= 1) {
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
     * Flash de color sobre toda la pantalla.
     * Usa WAAPI sobre el overlay DOM creado en init().
     * Bloquea hasta que desaparece.
     *
     * @param {'white'|'black'} color
     * @param {number}          durationMs — ciclo completo (in + out)
     */
    async fxFlash(color, durationMs) {
        this.#flashOverlay.style.background = color === 'white' ? '#ffffff' : '#000000';
        const half = durationMs / 2;

        await this.#flashOverlay.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: half, easing: EASING.snap, fill: 'forwards' }
        ).finished;

        await this.#flashOverlay.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: half, easing: EASING.easeOut, fill: 'forwards' }
        ).finished;

        this.#flashOverlay.style.opacity = '';
    }

    /**
     * Activa o desactiva la viñeta (oscurecimiento de bordes).
     * Usa WAAPI sobre el overlay DOM creado en init(). No bloquea.
     *
     * @param {boolean} active
     */
    fxVignette(active) {
        this.#vignetteOverlay.animate(
            [{ opacity: active ? 0 : 1 }, { opacity: active ? 1 : 0 }],
            { duration: 500, easing: EASING.easeInOut, fill: 'forwards' }
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIMPIEZA DE ESCENA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Vacía sprites, fondo y textbox sin destruir la app PixiJS.
     * Llamado desde Engine.reset().
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

        cancelAnimationFrame(this.#twRafId);
        this.#twRafId    = null;
        this.#twComplete = false;
        this.#twFullText = '';
        this.#twCallback = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CURSOR
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
    // PRIVADO — Ticker (animaciones sobre objetos PixiJS)
    // Regla: estos métodos solo tocan objetos con .alpha, .x, .y — nunca DOM.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Anima alpha de 0 a 1 usando el Ticker.
     * @param {object} obj — Sprite u objeto PixiJS con propiedad alpha
     * @param {number} [ms]
     */
    #tickerFadeIn(obj, ms = FADE_MS) {
        return new Promise(resolve => {
            obj.alpha   = 0;
            const start = performance.now();
            const tick  = () => {
                const t   = Math.min((performance.now() - start) / ms, 1);
                obj.alpha = applyEase(t, 'easeOut');
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * Anima alpha de su valor actual a 0 usando el Ticker.
     * @param {object} obj
     * @param {number} [ms]
     */
    #tickerFadeOut(obj, ms = FADE_MS) {
        return new Promise(resolve => {
            const startAlpha = obj.alpha;
            const start      = performance.now();
            const tick       = () => {
                const t   = Math.min((performance.now() - start) / ms, 1);
                obj.alpha = startAlpha * (1 - applyEase(t, 'easeOut'));
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * Mueve un objeto PixiJS hacia coordenadas destino usando el Ticker.
     * @param {object} obj
     * @param {number} targetX
     * @param {number} targetY
     * @param {number} [ms]
     */
    #tickerMoveTo(obj, targetX, targetY, ms = FADE_MS) {
        return new Promise(resolve => {
            const sx = obj.x;
            const sy = obj.y;
            const start = performance.now();
            const tick  = () => {
                const t  = Math.min((performance.now() - start) / ms, 1);
                const e  = applyEase(t, 'easeOut');
                obj.x    = sx + (targetX - sx) * e;
                obj.y    = sy + (targetY - sy) * e;
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * Anima el alpha de cualquier objeto PixiJS hacia un valor destino.
     * No bloquea — la siguiente instrucción se ejecuta inmediatamente.
     *
     * Corrección respecto a la versión anterior: usaba rAF directamente
     * para modificar una propiedad PixiJS, creando frames donde el render
     * ocurría antes de que el alpha se actualizara. Ahora usa el Ticker,
     * que se ejecuta sincronizado con el loop de render de PixiJS.
     *
     * @param {object} pixiObject — objeto con propiedad alpha (Sprite, Container…)
     * @param {number} target     — 0.0–1.0
     * @param {number} ms
     */
    #tickerTweenAlpha(pixiObject, target, ms) {
        const startAlpha = pixiObject.alpha;
        const delta      = target - startAlpha;
        const startTime  = performance.now();

        const tick = () => {
            const t = Math.min((performance.now() - startTime) / ms, 1);
            pixiObject.alpha = startAlpha + delta * applyEase(t, 'easeInOut');
            if (t >= 1) this.app.ticker.remove(tick);
        };
        this.app.ticker.add(tick);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO — utilidades
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {import('pixi.js').Sprite} sprite
     * @param {string} slot
     */
    #positionSprite(sprite, slot) {
        sprite.anchor.set(0.5, 1.0);
        sprite.x = this.app.screen.width  * (SLOT_X[slot] ?? 0.5);
        sprite.y = this.app.screen.height;
        const targetH = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    /** @param {string} actor */
    #destroySprite(actor) {
        const sprite = this.activeSprites.get(actor);
        if (sprite) {
            sprite.destroy({ texture: false });
            this.activeSprites.delete(actor);
        }
    }

    #onResize() {
        const { width, height } = this.app.screen;
        if (this.bgCurrent) {
            this.bgCurrent.width  = width;
            this.bgCurrent.height = height;
        }
        for (const [, sprite] of this.activeSprites) {
            if (sprite._dramSlot) this.#positionSprite(sprite, sprite._dramSlot);
        }
    }

    /** @param {string|number} value — '2s' | '500ms' | número en ms */
    #parseTime(value) {
        if (typeof value === 'number') return value;
        if (value.endsWith('ms')) return parseInt(value);
        return parseFloat(value) * 1000;
    }

    /** @param {boolean} visible */
    #setAdvance(visible) {
        this.#advanceIndicator?.classList.toggle('visible', visible);
    }
}
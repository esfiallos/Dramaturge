// src/modules/Renderer.js
//
// ARQUITECTURA DE CAPAS:
//   [PixiJS canvas]  → fondos y sprites        (z-index 5)
//   [DOM overlay]    → textbox, nombre, UI      (z-index 30+)
//
// CICLO DE VIDA OBLIGATORIO:
//   const renderer = new Renderer();
//   await renderer.init();   ← llamar antes que cualquier otro método
//
// API PÚBLICA HACIA ENGINE:
//   activateInstantMode()   → Engine lo llama antes de texto en modo skip
//   get isSkipLocked        → Engine lo consulta para proteger el avance
//   applyNarrationMode(on)  → Engine lo llama al restaurar estado desde save
//
// CONVENCIÓN DE CAMPOS:
//   #campo              → completamente privado, no accesible desde fuera
//   campo (sin #)       → público — Engine lo necesita directamente
//                         (nameEl, textEl, textBox, transition, activeSprites,
//                          bgCurrent, app, isTransitioning)

import { Application, Assets, Sprite, Container } from 'pixi.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Posición X normalizada (0–1) de cada slot de sprite. */
const SLOT_X = Object.freeze({ left: 0.20, center: 0.50, right: 0.80 });

/** Formatos probados en orden de preferencia al cargar imágenes. */
const IMAGE_FORMATS = ['webp', 'png', 'jpg', 'jpeg'];

/** Altura máxima de un sprite como fracción de la pantalla. */
const SPRITE_HEIGHT_RATIO = 0.82;

/** Duración por defecto de fades en ms. */
const FADE_MS = 500;

/** Ms entre caracteres en el typewriter. */
const TYPEWRITER_CHAR_MS = 28;

// ─── Helpers de módulo ────────────────────────────────────────────────────────

/**
 * Carga una textura probando formatos en orden de preferencia.
 * Si el path ya tiene extensión conocida, la intenta primero.
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
        catch { /* continuar con el siguiente */ }
    }
    return null;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class Renderer {

    // ── PixiJS — públicos (Engine y SceneManager los necesitan) ───────────

    /** @type {import('pixi.js').Application} */
    app;

    /** @type {import('pixi.js').Container} */
    bgLayer;

    /** @type {import('pixi.js').Container} */
    spriteLayer;

    /** @type {import('pixi.js').Sprite|null} */
    bgCurrent = null;

    /** @type {Map<string, import('pixi.js').Sprite>} — actorId → sprite activo */
    activeSprites;

    // ── DOM — públicos (Engine actualiza textbox directamente) ────────────

    /** @type {HTMLElement} */ nameEl;
    /** @type {HTMLElement} */ textEl;
    /** @type {HTMLElement} */ textBox;
    /** @type {HTMLElement} */ transition;

    // ── Estado de transición — público (Engine lo respeta en next()) ──────

    /**
     * True mientras se ejecuta una transición de modo (narración ↔ diálogo).
     * Engine no procesa input mientras sea true.
     * @type {boolean}
     */
    isTransitioning = false;

    // ── Typewriter — privado ───────────────────────────────────────────────

    /** @type {number|null} — handle del rAF activo */
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
     * Bloqueo post-skip: protege contra avance involuntario tras completar
     * texto por skip. Leer via getter isSkipLocked.
     * @type {boolean}
     */
    #skipLocked = false;

    // ── Elementos DOM internos (creados en init()) ────────────────────────

    /** @type {HTMLElement|null} */
    #advanceIndicator = null;

    constructor() {
        this.app          = new Application();
        this.activeSprites = new Map();
        this.nameEl     = document.getElementById('char-name');
        this.textEl     = document.getElementById('char-text');
        this.textBox    = document.getElementById('text-box');
        this.transition = document.getElementById('scene-transition');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN
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

        this.#advanceIndicator = document.createElement('span');
        this.#advanceIndicator.id          = 'advance-indicator';
        this.#advanceIndicator.textContent = '▼';
        this.textBox?.appendChild(this.#advanceIndicator);

        console.log('[Renderer] PixiJS v8 inicializado.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API PÚBLICA — modos de avance
    // (contrato con Engine — no acceder a los campos # directamente)
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
     * True si el skip-lock está activo. Engine lo consulta para ignorar
     * el input durante el breve periodo de protección post-skip.
     * @returns {boolean}
     */
    get isSkipLocked() {
        return this.#skipLocked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPRITES
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

    /**
     * @param {string} actor
     * @param {string} slot
     * @param {string} [effect]
     */
    async hideSprite(actor, slot, effect = 'fade') {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;
        if (effect === 'fade') await this.#fadeOut(sprite);
        this.#destroySprite(actor);
    }

    /**
     * Cambia la textura del sprite activo de un actor (cambio de pose).
     * @param {string} actor
     * @param {string} path
     */
    async updateSprite(actor, path) {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;

        const texture = await loadTexture(path);
        if (!texture) { console.warn(`[Renderer] updateSprite: no encontrado ${path}`); return; }

        sprite.texture = texture;
        const targetH  = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FONDO
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

        if (effect === 'fade') await this.#fadeIn(newBg, ms);
        else newBg.alpha = 1;

        if (this.bgCurrent) this.bgCurrent.destroy();
        this.bgCurrent = newBg;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TYPEWRITER
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Inicia el efecto typewriter para una línea de texto.
     *
     * @param {string|null} name   — nombre del personaje, o null para narración
     * @param {string}      text   — texto completo a escribir
     * @param {Function}    onDone — llamado cuando el jugador puede avanzar
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

        // Modo instantáneo (skip): completar sin animación
        if (this.#instantModeActive) {
            this.#instantModeActive = false;
            this.textEl.innerText   = text;
            this.#twComplete        = true;
            this.#setAdvance(false); // en skip no se muestra el ▼
            this.#twCallback?.();
            return;
        }

        // rAF typewriter — velocidad consistente independiente del hardware
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
     * Completa el texto instantáneamente si el typewriter está en curso.
     * Aplica skip-lock breve para evitar doble-avance accidental.
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
     * Aplica el modo visual narración / diálogo al textbox.
     * Llamado desde typewriter() y desde Engine.resumeFromState().
     *
     * @param {boolean} active — true = narración, false = diálogo
     */
    applyNarrationMode(active) {
        this.textBox.classList.toggle('narration-mode', active);
        this.#tweenSpriteAlpha(active ? 0.15 : 1, 200);
    }

    /**
     * Transición con crossfade entre modo narración y diálogo.
     * Si el modo no cambia, resuelve inmediatamente.
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

        overlay.style.background = '#000000';
        overlay.style.transition = `opacity ${fadeMs}ms ease-in`;
        overlay.classList.add('active');

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                setTimeout(resolve, fadeMs);
            });
        });

        cancelAnimationFrame(this.#twRafId);
        this.#twRafId = null;
        if (this.textEl) this.textEl.innerText = '';
        if (this.nameEl) this.nameEl.innerText = '';
        this.#setAdvance(false);
        this.textBox.classList.toggle('narration-mode', toNarration);
        this.#tweenSpriteAlpha(toNarration ? 0.15 : 1, fadeMs * 2);

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
    // LIMPIEZA DE ESCENA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Vacía sprites, fondo y textbox sin destruir la app PixiJS.
     * Llamar desde Engine.reset().
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
    // TRANSICIÓN DE ESCENA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fade fullscreen entre escenas (goto fade:black / fade:white).
     * @param {'black'|'white'} color
     * @param {number}          ms
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
    // EFECTOS DE PANTALLA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sacude el stage lateralmente. Bloquea hasta que termina.
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
                const t       = Math.min((performance.now() - start) / durationMs, 1);
                const amp     = intensity * (1 - t);
                stage.x       = originX + (Math.random() * 2 - 1) * amp;
                stage.y       = originY + (Math.random() * 2 - 1) * amp * 0.5;

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
     * Flash de color (fade in + fade out). Bloquea hasta que desaparece.
     * @param {'white'|'black'} color
     * @param {number}          durationMs — ciclo completo
     */
    fxFlash(color, durationMs) {
        return new Promise(resolve => {
            let overlay = document.getElementById('fx-flash-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'fx-flash-overlay';
                Object.assign(overlay.style, {
                    position: 'absolute', inset: '0', zIndex: '20',
                    pointerEvents: 'none', opacity: '0',
                });
                document.getElementById('viewport')?.appendChild(overlay);
            }

            const half = durationMs / 2;
            overlay.style.background = color === 'white' ? '#ffffff' : '#000000';
            overlay.style.transition = `opacity ${half}ms ease`;
            overlay.style.opacity    = '0';
            void overlay.offsetHeight;
            overlay.style.opacity = '1';

            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(resolve, half);
            }, half);
        });
    }

    /**
     * Activa o desactiva viñeta sobre el canvas. No bloquea.
     * @param {boolean} active
     */
    fxVignette(active) {
        let el = document.getElementById('fx-vignette-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fx-vignette-overlay';
            Object.assign(el.style, {
                position: 'absolute', inset: '0', zIndex: '15',
                pointerEvents: 'none', opacity: '0', transition: 'opacity 0.5s ease',
                background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.72) 100%)',
            });
            document.getElementById('viewport')?.appendChild(el);
        }
        el.style.opacity = active ? '1' : '0';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO
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

    /**
     * Anima el alpha del spriteLayer con ease in-out cuadrático.
     * @param {number} target — 0.0–1.0
     * @param {number} ms
     */
    #tweenSpriteAlpha(target, ms) {
        const start     = this.spriteLayer.alpha;
        const delta     = target - start;
        const startTime = performance.now();

        const tick = (now) => {
            const t    = Math.min((now - startTime) / ms, 1);
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            this.spriteLayer.alpha = start + delta * ease;
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /**
     * @param {object} obj — Sprite u objeto PixiJS con alpha
     * @param {number} [ms]
     */
    #fadeIn(obj, ms = FADE_MS) {
        return new Promise(resolve => {
            obj.alpha   = 0;
            const start = performance.now();
            const tick  = () => {
                const t   = Math.min((performance.now() - start) / ms, 1);
                obj.alpha = t;
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * @param {object} obj
     * @param {number} [ms]
     */
    #fadeOut(obj, ms = FADE_MS) {
        return new Promise(resolve => {
            const startAlpha = obj.alpha;
            const start      = performance.now();
            const tick       = () => {
                const t   = Math.min((performance.now() - start) / ms, 1);
                obj.alpha = startAlpha * (1 - t);
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /**
     * Ease-out cúbico — movimientos naturales.
     * @param {object} obj
     * @param {number} targetX
     * @param {number} targetY
     * @param {number} [ms]
     */
    #moveTo(obj, targetX, targetY, ms = FADE_MS) {
        return new Promise(resolve => {
            const sx = obj.x;
            const sy = obj.y;
            const start = performance.now();
            const tick  = () => {
                const t    = Math.min((performance.now() - start) / ms, 1);
                const ease = 1 - Math.pow(1 - t, 3);
                obj.x      = sx + (targetX - sx) * ease;
                obj.y      = sy + (targetY - sy) * ease;
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }
}
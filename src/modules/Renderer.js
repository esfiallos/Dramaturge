// src/modules/Renderer.js
//
// ARQUITECTURA DE CAPAS:
//   [PIXI Canvas]  → fondos y sprites (z-index: 5)
//   [DOM Overlay]  → textbox, nombre, UI (z-index: 30+)
//
// CICLO DE VIDA OBLIGATORIO (PixiJS v8):
//   const renderer = new MERenderer();
//   await renderer.init();            ← debe llamarse antes de cualquier otro método

import { Application, Assets, Sprite, Container } from 'pixi.js';

// ─── Constantes de configuración ─────────────────────────────────────────────

const SLOT_X   = { left: 0.20, center: 0.50, right: 0.80 };

// Formatos de imagen soportados en orden de preferencia.
// Si el path ya tiene extensión conocida, se usa directamente.
// Si no, se prueban en orden hasta que uno cargue.
const IMAGE_FORMATS = ['webp', 'png', 'jpg', 'jpeg'];

/**
 * Carga una textura probando múltiples formatos si el path no tiene extensión.
 * @param   {string}  path - Puede tener extensión ('v_idle.webp') o no ('v_idle')
 * @returns {Promise<Texture|null>}
 */
/**
 * Carga una textura probando todos los formatos en orden.
 *
 * PixiJS Assets necesita la extensión en la URL para seleccionar el parser
 * correcto — sin ella lanza un warning y falla. Por eso siempre probamos
 * con extensión explícita.
 *
 * Estrategia:
 *   1. Si el path ya tiene extensión conocida → intentarla primero.
 *   2. Probar el resto de formatos con la ruta base (sin extensión).
 *
 * Así funciona tanto con 'v_idle.webp' como con 'v_idle' o 'forest.jpg'.
 */
async function loadTexture(path) {
    // Obtener la ruta base (sin extensión si la tiene)
    const ext  = IMAGE_FORMATS.find(f => path.toLowerCase().endsWith(`.${f}`));
    const base = ext ? path.slice(0, -(ext.length + 1)) : path;

    // Orden de intento: extensión original primero (si existe), luego las demás
    const order = ext
        ? [ext, ...IMAGE_FORMATS.filter(f => f !== ext)]
        : IMAGE_FORMATS;

    for (const fmt of order) {
        try {
            return await Assets.load(`${base}.${fmt}`);
        } catch { /* continuar con el siguiente */ }
    }
    return null;
}
const SPRITE_HEIGHT_RATIO = 0.82;
const FADE_MS             = 500;
const TW_SPEED            = 28;

// ─── Clase principal ──────────────────────────────────────────────────────────

export class Renderer {

    constructor() {
        // El constructor es SÍNCRONO.
        // PixiJS v8 requiere que las opciones se pasen a init(), no al constructor.
        this.app = new Application();

        // Referencias DOM — disponibles de inmediato, antes de init()
        this.nameEl  = document.getElementById('char-name');
        this.textEl  = document.getElementById('char-text');
        this.textBox    = document.getElementById('text-box');
        this.transition = document.getElementById('scene-transition');

        // Estado interno
        this.activeSprites = new Map();
        this.bgCurrent     = null;

        // Estado del typewriter
        this._twRafId    = null;   // handle de rAF activo
        this._twFullText = '';
        this._twOnDone   = null;
        this._twDone     = false;

        // Bloqueo durante transición de modo — el Engine lo respeta en next()
        this.isTransitioning = false;

        // Cuando true, el typewriter completa el texto instantáneamente (modo skip).
        // El Engine lo activa antes de llamar typewriter(); se limpia solo después.
        this._instantText = false;

        // Lock post-skip: evita que un doble clic rápido salte el texto recién completado
        this._skipLocked = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN (async — llamar una sola vez desde main.js)
    // ─────────────────────────────────────────────────────────────────────────

    async init() {
        const viewport = document.getElementById('viewport');

        // v8: opciones en init(), no en el constructor
        await this.app.init({
            resizeTo:   viewport,
            background: 0x000000,
            antialias:  true,
            autoDensity: true,
            resolution: window.devicePixelRatio || 1,
        });

        // v8: app.canvas reemplaza al deprecado app.view
        const canvas = this.app.canvas;
        canvas.style.cssText = 'position:absolute;inset:0;z-index:5;';

        const clickZone = viewport.querySelector('#click-zone');
        viewport.insertBefore(canvas, clickZone);

        this.bgLayer     = new Container();
        this.spriteLayer = new Container();
        this.app.stage.addChild(this.bgLayer, this.spriteLayer);

        this.app.renderer.on('resize', () => this._onResize());

        // ── Indicador de avance ───────────────────────────────────────────
        // Triángulo parpadeante que aparece cuando el typewriter termina
        this._advanceEl = document.createElement('span');
        this._advanceEl.id = 'advance-indicator';
        this._advanceEl.textContent = '▼';
        this.textBox?.appendChild(this._advanceEl);

        // Capa de fade DOM — cubre todo el viewport para transiciones
        // de escena (goto fade:black / fade:white)
        this._fadeLayer = document.createElement('div');
        this._fadeLayer.style.cssText = [
            'position:absolute', 'inset:0', 'z-index:25',
            'pointer-events:none', 'opacity:0',
            'transition:opacity 0ms linear',
            'background:#000',
        ].join(';');
        viewport.appendChild(this._fadeLayer);

        console.log('[Renderer] PixiJS v8 inicializado.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPRITES
    // ─────────────────────────────────────────────────────────────────────────

    async renderSprite(actor, path, slot, effect = 'fade') {
        this._destroySprite(actor);

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] Sprite no encontrado en ningún formato: ${path}`);
            return;
        }

        const sprite  = new Sprite(texture);
        sprite._dramSlot = slot; // guardado para _onResize

        this._positionSprite(sprite, slot);
        sprite.alpha = 0;
        this.spriteLayer.addChild(sprite);
        this.activeSprites.set(actor, sprite);

        if (effect === 'fade') {
            await this._fadeIn(sprite);
        } else if (effect === 'slide') {
            sprite.y += 50;
            await Promise.all([
                this._fadeIn(sprite),
                this._moveTo(sprite, sprite.x, sprite.y - 50),
            ]);
        } else {
            sprite.alpha = 1;
        }
    }

    async hideSprite(actor, slot, effect = 'fade') {
        const sprite = this.activeSprites.get(actor);
        if (!sprite) return;

        if (effect === 'fade') await this._fadeOut(sprite);
        this._destroySprite(actor);
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

        const targetH = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FONDO
    // ─────────────────────────────────────────────────────────────────────────

    async changeBackground(target, effect = 'fade', time = '1s') {
        const durationMs = this._parseTime(time);
        const path       = `${import.meta.env.BASE_URL}assets/bg/${target}`; // sin extensión: loadTexture prueba webp→png→jpg

        const texture = await loadTexture(path);
        if (!texture) {
            console.warn(`[Renderer] Fondo no encontrado en ningún formato: ${path}`);
            return;
        }

        const newBg  = new Sprite(texture);
        newBg.alpha  = 0;
        newBg.width  = this.app.screen.width;
        newBg.height = this.app.screen.height;
        this.bgLayer.addChild(newBg);

        if (effect === 'fade') {
            await this._fadeIn(newBg, durationMs);
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
     * Inicia el efecto typewriter.
     * Ahora es async — espera el crossfade de narración antes de empezar a escribir.
     * El engine debe hacer: await renderer.typewriter(...)
     */
    async typewriter(name, text, onDone) {
        this._twFullText = text;
        this._twOnDone   = onDone;
        this._twDone     = false;
        this._skipLocked = false;

        const isNarration = !name;

        // Ocultar indicador mientras escribe
        this._setAdvance(false);

        // Limpiar texto ANTES del crossfade — _setNarrationMode hace fade out
        // primero (opacity 0), así el swap ocurre mientras la caja es invisible.
        // Cubre todos los casos: diálogo→narrador, narrador→diálogo, puzzle→narrador, etc.
        this.nameEl.innerText = '';
        this.textEl.innerText = '';

        await this._setNarrationMode(isNarration);

        // Nombre se fija después del crossfade, justo antes de empezar a escribir
        this.nameEl.innerText = isNarration ? '' : name;

        // Modo skip: completar texto sin animación (un solo frame)
        if (this._instantText) {
            this._instantText    = false; // consumir el flag
            this.textEl.innerText = text;
            this._twDone          = true;
            this._setAdvance(false); // en skip no mostramos el ▼
            this._twOnDone?.();
            return;
        }

        // rAF typewriter — velocidad consistente independiente del hardware
        // y del estado del tab (no se dispara en background como setInterval).
        // Acumula tiempo real y emite un carácter por cada TW_SPEED ms transcurridos.
        let i          = 0;
        let lastTime   = null;
        let accumulated = 0;

        this._twRafId = null;
        cancelAnimationFrame(this._twRafId);

        const tick = (now) => {
            if (lastTime === null) lastTime = now;
            accumulated += now - lastTime;
            lastTime = now;

            // Emitir todos los caracteres que correspondan al tiempo acumulado
            while (accumulated >= TW_SPEED && i < text.length) {
                this.textEl.append(text.charAt(i++));
                accumulated -= TW_SPEED;
            }

            if (i < text.length) {
                this._twRafId = requestAnimationFrame(tick);
            } else {
                this._twRafId = null;
                this._twDone  = true;
                this._setAdvance(true);
                this._twOnDone?.();
            }
        };

        this._twRafId = requestAnimationFrame(tick);
    }

    skipTypewriter() {
        if (this._twDone) return;

        cancelAnimationFrame(this._twRafId);
        this._twRafId         = null;
        this.textEl.innerText = this._twFullText;
        this._twDone          = true;

        // Lock breve: el usuario necesita ver el texto completo
        // antes de poder avanzar al siguiente paso
        this._skipLocked = true;
        this._setAdvance(true);
        setTimeout(() => { this._skipLocked = false; }, 180);

        this._twOnDone?.();
    }

    /**
     * Feedback visual al intentar avanzar cuando el texto no terminó.
     * Pulso sutil en el borde de la caja — indica "espera, estoy escribiendo".
     */
    /**
     * Cambia el cursor del click-zone según si se puede avanzar.
     * 'ready'  → pointer (puede hacer clic)
     * 'wait'   → default (transición en curso, no hacer clic)
     * 'typing' → pointer con indicación de skip disponible
     */
    /**
     * Limpia la escena visual completamente.
     * Llamado por Engine.reset() al iniciar una nueva partida.
     * No destruye la app PixiJS — solo vacía sprites y fondo.
     */
    clearScene() {
        // Destruir todos los sprites activos
        for (const sprite of this.activeSprites.values()) {
            sprite.destroy({ texture: false });
        }
        this.activeSprites.clear();

        // Destruir el fondo
        if (this.bgCurrent) {
            this.bgCurrent.destroy({ texture: false });
            this.bgCurrent = null;
        }

        // Limpiar textbox
        if (this.nameEl) this.nameEl.innerText = '';
        if (this.textEl) this.textEl.innerText = '';
        this._setAdvance(false);

        // Cancelar typewriter en curso
        cancelAnimationFrame(this._twRafId);
        this._twRafId    = null;
        this._twDone     = false;
        this._twFullText = '';
        this._twOnDone   = null;
    }

    setCursorState(state) {
        const zone = document.getElementById('click-zone');
        if (!zone) return;
        if (state === 'wait') {
            zone.style.cursor = 'default';
            zone.style.pointerEvents = 'none';
        } else {
            zone.style.cursor = 'pointer';
            zone.style.pointerEvents = '';
        }
    }

    flashTextBox() {
        if (!this.textBox) return;
        this.textBox.classList.remove('click-flash');
        // Forzar reflow para reiniciar la animación si se llama repetido
        void this.textBox.offsetWidth;
        this.textBox.classList.add('click-flash');
        setTimeout(() => this.textBox.classList.remove('click-flash'), 150);
    }

    /** Muestra u oculta el indicador de avance (▼) */
    _setAdvance(visible) {
        if (!this._advanceEl) return;
        this._advanceEl.classList.toggle('visible', visible);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    _positionSprite(sprite, slot) {
        sprite.anchor.set(0.5, 1.0);
        sprite.x = this.app.screen.width  * (SLOT_X[slot] ?? 0.5);
        sprite.y = this.app.screen.height;

        const targetH = this.app.screen.height * SPRITE_HEIGHT_RATIO;
        sprite.scale.set(targetH / sprite.texture.height);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSICIÓN DE ESCENA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ejecuta una transición de pantalla completa entre escenas.
     * Fade to color → callback → fade from color.
     *
     * @param {'black'|'white'} color - color del fundido
     * @param {number}          ms    - duración de cada mitad (fade in + fade out)
     * @returns {Promise<void>}       - resuelve cuando la transición completa
     */
    async sceneTransition(color = 'black', ms = 500) {
        const overlay = this.transition;
        if (!overlay) return;

        overlay.style.background  = color === 'white' ? '#fff' : '#000';
        overlay.style.transition  = `opacity ${ms}ms ease`;
        overlay.classList.add('active');

        // Fade IN (oscurece/blanquea la pantalla)
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                setTimeout(resolve, ms);
            });
        });

        // El SceneManager carga la siguiente escena durante la pausa
        // (el Engine ya llamó sceneLoader antes de llamar sceneTransition)
        // Pequeña pausa en negro/blanco para que se sienta el corte narrativo
        await new Promise(r => setTimeout(r, 80));

        // Fade OUT (revela la nueva escena)
        overlay.style.opacity = '0';
        await new Promise(r => setTimeout(r, ms));

        overlay.classList.remove('active');
        overlay.style.transition = '';
    }

    /**
     * Cambia entre modo diálogo y modo narración con crossfade suave.
     * Ahora es async — el typewriter espera a que termine.
     *
     * @param {boolean} active   - true = narración, false = diálogo
     * @param {number}  [ms=220] - duración del crossfade en ms
     */
    async _setNarrationMode(active) {
        // modeTransition ya aplicó la clase y el fade negro antes de llamar
        // al typewriter — aquí solo corregimos si por algún motivo difieren
        // (ej: primera línea del script sin transición previa).
        this.textBox.classList.toggle('narration-mode', active);
        if (active) {
            this._tweenSpriteAlpha(0.15, 200);
        } else {
            this._tweenSpriteAlpha(1, 200);
        }
    }

    /**
     * Transición de modo narrador ↔ diálogo al estilo Umineko.
     *
     * Cuando el modo CAMBIA (narración→diálogo o diálogo→narración):
     *   1. Bloquea el engine (isTransitioning = true)
     *   2. Fade a blanco fullscreen en fadeMs
     *   3. Pausa holdMs para que el jugador perciba el corte
     *   4. Fade out del blanco
     *   5. Desbloquea (isTransitioning = false)
     *
     * Si el modo NO cambia, resuelve inmediatamente sin efectos.
     *
     * @param {boolean} toNarration - true = vamos a narración, false = vamos a diálogo
     * @param {number}  fadeMs      - duración del fade in/out (ms)
     * @param {number}  holdMs      - tiempo en blanco antes del fade out (ms)
     * @returns {Promise<void>}
     */
    async modeTransition(toNarration, fadeMs = 140) {
        const alreadyNarration = this.textBox.classList.contains('narration-mode');

        // Sin cambio de modo — nada que hacer
        if (alreadyNarration === toNarration) return;

        const overlay = this.transition;
        if (!overlay) return;

        this.isTransitioning = true;

        // ── Fase 1: Fade a negro (rápido) ────────────────────────────────
        overlay.style.background = '#000000';
        overlay.style.transition = `opacity ${fadeMs}ms ease-in`;
        overlay.classList.add('active');

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                setTimeout(resolve, fadeMs);
            });
        });

        // ── Pantalla en negro: preparar todo de golpe ─────────────────────
        // Cancelar typewriter en curso si lo hay
        cancelAnimationFrame(this._twRafId);
        this._twRafId = null;
        if (this.textEl)  this.textEl.innerText = '';
        if (this.nameEl)  this.nameEl.innerText = '';
        this._setAdvance(false);

        // Cambiar modo de textbox mientras nadie puede verlo
        this.textBox.classList.toggle('narration-mode', toNarration);

        // Ajustar alpha de sprites para el modo destino
        const targetAlpha = toNarration ? 0.15 : 1;
        this._tweenSpriteAlpha(targetAlpha, fadeMs * 2);

        // ── Fase 2: Fade-out del negro EN BACKGROUND ──────────────────────
        // Arrancamos el reveal pero NO esperamos — el typewriter empieza
        // mientras el negro se levanta, dando la sensación de una sola acción.
        overlay.style.transition = `opacity ${fadeMs * 1.8}ms ease-out`;
        requestAnimationFrame(() => { overlay.style.opacity = '0'; });

        // Limpiar el overlay cuando termine (sin bloquear)
        setTimeout(() => {
            overlay.classList.remove('active');
            overlay.style.transition = '';
            overlay.style.background = '';
        }, fadeMs * 1.8 + 20);

        // Desbloquear el engine: el typewriter arranca solapado con el fade-out
        this.isTransitioning = false;
    }

    /**
     * Anima el alpha del spriteLayer suavemente.
     * @param {number} target  - alpha destino (0.0–1.0)
     * @param {number} ms      - duración en ms
     */
    _tweenSpriteAlpha(target, ms) {
        const start     = this.spriteLayer.alpha;
        const delta     = target - start;
        const startTime = performance.now();

        const tick = (now) => {
            const t = Math.min((now - startTime) / ms, 1);
            // Ease in-out cuadrático
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            this.spriteLayer.alpha = start + delta * ease;
            if (t < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
    }

    _destroySprite(actor) {
        const existing = this.activeSprites.get(actor);
        if (existing) {
            existing.destroy({ texture: false });
            this.activeSprites.delete(actor);
        }
    }

    _onResize() {
        const w = this.app.screen.width;
        const h = this.app.screen.height;

        // Reescalar fondo
        if (this.bgCurrent) {
            this.bgCurrent.width  = w;
            this.bgCurrent.height = h;
        }

        // Reposicionar todos los sprites activos
        for (const [, sprite] of this.activeSprites) {
            const slot = sprite._dramSlot;
            if (slot) this._positionSprite(sprite, slot);
        }
    }

    _parseTime(str = '1s') {
        if (typeof str === 'number') return str;
        if (str.endsWith('ms')) return parseInt(str);
        return parseFloat(str) * 1000;
    }

    _fadeIn(obj, durationMs = FADE_MS) {
        return new Promise(resolve => {
            obj.alpha   = 0;
            const start = performance.now();
            const tick  = () => {
                const t   = Math.min((performance.now() - start) / durationMs, 1);
                obj.alpha = t;
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    _fadeOut(obj, durationMs = FADE_MS) {
        return new Promise(resolve => {
            const startAlpha = obj.alpha;
            const start      = performance.now();
            const tick       = () => {
                const t   = Math.min((performance.now() - start) / durationMs, 1);
                obj.alpha = startAlpha * (1 - t);
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    /** Ease-out cúbico — movimientos naturales, no mecánicos. */
    _moveTo(obj, targetX, targetY, durationMs = FADE_MS) {
        return new Promise(resolve => {
            const startX = obj.x;
            const startY = obj.y;
            const start  = performance.now();
            const tick   = () => {
                const t    = Math.min((performance.now() - start) / durationMs, 1);
                const ease = 1 - Math.pow(1 - t, 3);
                obj.x      = startX + (targetX - startX) * ease;
                obj.y      = startY + (targetY - startY) * ease;
                if (t >= 1) { this.app.ticker.remove(tick); resolve(); }
            };
            this.app.ticker.add(tick);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EFECTOS DE PANTALLA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sacude el stage de PixiJS lateralmente durante la duración indicada.
     * Usa el PixiJS Ticker para sincronizar con el loop de render.
     * Bloquea hasta que termina — el Engine hace await antes de _nextInternal().
     *
     * @param {number} durationMs - Duración total del shake en milisegundos
     * @returns {Promise<void>}
     */
    fxShake(durationMs) {
        return new Promise(resolve => {
            const stage      = this.app.stage;
            const originX    = stage.x;
            const originY    = stage.y;
            const intensity  = 8;  // píxeles máximos de desplazamiento
            const start      = performance.now();

            const tick = () => {
                const elapsed = performance.now() - start;
                const t       = Math.min(elapsed / durationMs, 1);

                // La intensidad decae conforme se acerca al final (ease-out)
                const decay     = 1 - t;
                const amplitude = intensity * decay;

                stage.x = originX + (Math.random() * 2 - 1) * amplitude;
                stage.y = originY + (Math.random() * 2 - 1) * amplitude * 0.5;

                if (t >= 1) {
                    // Restaurar posición exacta al terminar
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
     * Usa un overlay DOM encima del canvas — más simple que un sprite PixiJS
     * y garantiza que tape absolutamente todo (HUD incluido si se desea).
     * Bloquea hasta que el overlay desaparece completamente.
     *
     * @param {'white'|'black'} color
     * @param {number}          durationMs - Duración del ciclo completo (flash in + out)
     * @returns {Promise<void>}
     */
    fxFlash(color, durationMs) {
        return new Promise(resolve => {
            // Reutilizar #scene-transition si existe, o crear un overlay temporal
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

            overlay.style.background  = color === 'white' ? '#ffffff' : '#000000';
            overlay.style.transition  = `opacity ${halfMs}ms ease`;
            overlay.style.opacity     = '0';

            // Forzar reflow
            void overlay.offsetHeight;

            // Flash IN
            overlay.style.opacity = '1';

            setTimeout(() => {
                // Flash OUT
                overlay.style.opacity = '0';
                setTimeout(() => resolve(), halfMs);
            }, halfMs);
        });
    }

    /**
     * Activa o desactiva una viñeta (oscurecimiento de bordes) sobre el canvas.
     * Instantáneo — no bloquea el engine.
     * Usa un elemento DOM con gradiente radial para evitar afectar el render PixiJS.
     *
     * @param {boolean} active - true = encender, false = apagar
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
}

/** Pequeña utilidad async para esperar ms — usada en animaciones DOM */
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
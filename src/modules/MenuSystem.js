// src/modules/MenuSystem.js
//
// ARQUITECTURA — Máquina de estados + paneles flotantes
//
// ESTADOS:
//   MAIN_MENU → LOADING → IN_GAME ↔ PAUSED
//
// REGLA DE ORO:
//   Solo #main-menu, #hud y #pause-menu viven en index.html.
//   Todos los paneles secundarios (slots, ajustes, audio, modal, toast, loading)
//   son creados por MenuSystem y appended directamente a document.body.
//   Así son independientes de la jerarquía del DOM y siempre visibles.
//
// BOTONES:
//   Menú principal  → "Continuar"      = abre slot-panel (load)
//                  → "Cargar Partida"  = abre slot-panel (load)  [alias de Continuar]
//                  → "Nueva Partida"   = empieza desde cero
//   Pausa           → "Continuar"      = cierra la pausa, vuelve al juego
//                  → "Guardar"         = abre slot-panel (save)
//                  → "Cargar"          = abre slot-panel (load)
//                  → "Ajustes"         = abre panel de ajustes
//                  → "Menú Principal"  = modal de confirmación → MAIN_MENU
//   HUD             → "Guardar"        = quicksave a slot_1
//                  → "Pausa"           = abre pausa
//                  → "Salir"           = autosave + MAIN_MENU directo

export class MenuSystem {

    static STATES = {
        MAIN_MENU: 'MAIN_MENU',
        LOADING:   'LOADING',
        IN_GAME:   'IN_GAME',
        PAUSED:    'PAUSED',
    };

    /** Estado actual — leído por InputGate en main.js */
    get state() { return this._state; }

    /** True si el backlog está abierto — leído por InputGate */
    get backlogOpen() { return this._isBacklogOpen(); }

    constructor({ engine, saveManager, sceneManager, audio,
                  startScene   = 'cap01/scene_01',
                  gameTitle    = 'DRAMATURGE',
                  gameSubtitle = 'Novela Visual' }) {

        this.engine       = engine;
        this.saveManager  = saveManager;
        this.sceneManager = sceneManager;
        this.audio        = audio;
        this.startScene   = startScene;
        this.gameTitle    = gameTitle;
        this.gameSubtitle = gameSubtitle;

        this._state      = null;
        this._busy       = false;
        this._saves      = {};
        this._autosave   = null;
        this._savesReady = null;
        this._els        = {};
        this._toastTimer = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────────────────────

    async init() {
        this._bindStaticEls();  // elementos que existen en index.html
        this._buildPanels();    // paneles creados dinámicamente en body
        this._populateMenu();
        this._bindEvents();
        this._setState(MenuSystem.STATES.MAIN_MENU);
        this._savesReady = this._loadSaves();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MÁQUINA DE ESTADOS
    // ─────────────────────────────────────────────────────────────────────────

    _setState(newState) {
        this._state = newState;
        const S = MenuSystem.STATES;

        // Ocultar absolutamente todo
        this._els.mainMenu?.classList.add('hidden');
        this._els.hud?.classList.remove('visible');
        this._els.pauseMenu?.classList.remove('visible');
        this._closeAllPanels();
        this.engine.isBlocked = false;

        switch (newState) {
            case S.MAIN_MENU:
                this._els.mainMenu?.classList.remove('hidden');
                this._stopHUDClock();
                this._updateMainMenuButtons();
                break;

            case S.LOADING:
                // El loading overlay se maneja con _showLoading/_hideLoading
                break;

            case S.IN_GAME:
                this._els.hud?.classList.add('visible');
                this._updateHUDInfo();
                this._startHUDClock();
                // Restaurar audio si veníamos de pausa
                this.audio.pauseUnduck?.();
                break;

            case S.PAUSED:
                this._els.hud?.classList.add('visible');
                this._els.pauseMenu?.classList.add('visible');
                this.engine.isBlocked = true;
                // stopModes dispara _skipOnStop → limpia visual del botón skip
                this.engine.stopModes?.();
                this._els.btnAuto?.classList.remove('hud-btn--active');
                this._els.btnSkip?.classList.remove('hud-btn--active');
                // Atenuar audio en pausa
                this.audio.pauseDuck?.();
                break;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BIND DOM — solo los elementos que DEBEN estar en index.html
    // ─────────────────────────────────────────────────────────────────────────

    _bindStaticEls() {
        const $ = (id) => document.getElementById(id);
        this._els = {
            // Menú principal (en index.html)
            mainMenu:    $('main-menu'),
            menuTitle:   $('menu-title'),
            menuSub:     $('menu-subtitle'),
            btnNew:      $('btn-new-game'),
            btnLoad:     $('btn-load'),

            // HUD (en index.html)
            hud:      $('hud'),
            btnSave:  $('btn-save'),
            btnPause: $('btn-pause'),
            btnExit:      $('btn-exit'),
            btnBacklog:   $('btn-backlog'),
            btnAuto:      $('btn-auto'),
            btnSkip:      $('btn-skip'),
            hudTitle:     $('hud-title'),
            hudScene:     $('hud-scene'),
            hudPlaytime:  $('hud-playtime'),

            // Menú de pausa (en index.html)
            pauseMenu:    $('pause-menu'),
            btnResume:    $('btn-resume'),
            btnSaveSlot:  $('btn-save-slot'),
            btnLoadSlot:  $('btn-load-slot'),
            btnSettings:  $('btn-settings'),
            btnMainMenu:  $('btn-main-menu'),
        };
    }


    // ─────────────────────────────────────────────────────────────────────────
    // AUTO / SKIP
    // ─────────────────────────────────────────────────────────────────────────

    _toggleAuto() {
        const active = this.engine.toggleAuto();
        this._els.btnAuto?.classList.toggle('hud-btn--active', active);
        this._els.btnSkip?.classList.remove('hud-btn--active');
    }

    _triggerSkip() {
        const btn = this._els.btnSkip;
        const active = this.engine.triggerSkip(() => {
            // Callback: skip paró solo (llegó a contenido nuevo o fue cancelado)
            btn?.classList.remove('hud-btn--active');
        });
        // true = skip arrancó, false = no hay nada que skipear o se canceló
        btn?.classList.toggle('hud-btn--active', active);
        if (active) {
            // Quitar auto si estaba activo
            this._els.btnAuto?.classList.remove('hud-btn--active');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HUD INFO
    // ─────────────────────────────────────────────────────────────────────────

    _updateHUDInfo() {
        if (this._els.hudTitle)
            this._els.hudTitle.textContent = this.gameTitle;

        const file = this.engine.state.currentFile ?? '';
        // "cap01/scene_02.dan" → "Cap 01 · Escena 02"
        const parts = file.replace('.dan', '').split('/');
        const sceneLabel = parts
            .map(p => p.replace(/_/g, ' ').replace(/\w/g, l => l.toUpperCase()))
            .join(' · ');
        if (this._els.hudScene)
            this._els.hudScene.textContent = sceneLabel;
    }

    _startHUDClock() {
        this._stopHUDClock();
        this._hudClockInterval = setInterval(() => {
            if (this._state !== MenuSystem.STATES.IN_GAME) return;
            const total = (this.engine.state.playTime ?? 0) +
                Math.floor((Date.now() - (this.engine._sessionStart ?? Date.now())) / 1000);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
            const s = (total % 60).toString().padStart(2, '0');
            const label = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
            if (this._els.hudPlaytime)
                this._els.hudPlaytime.textContent = label;
        }, 1000);
    }

    _stopHUDClock() {
        clearInterval(this._hudClockInterval);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD PANELS — creados en document.body, independientes del DOM
    // ─────────────────────────────────────────────────────────────────────────

    _buildPanels() {
        this._buildSlotPanel();
        this._buildAudioPanel();
        this._buildBacklogPanel();
        this._buildModal();
        this._buildLoadingOverlay();
        this._buildToast();
    }

    _buildSlotPanel() {
        const el = this._createPanel('dm-slot-panel', `
            <div class="dm-panel__inner">
                <h2 class="dm-panel__title" id="dm-slot-title">— Cargar Partida —</h2>
                <div class="dm-slot-list" id="dm-slot-list"></div>
                <button class="btn-gold dm-panel__back" id="dm-slot-back">← Volver</button>
            </div>
        `);
        this._els.slotPanel  = el;
        this._els.slotTitle  = document.getElementById('dm-slot-title');
        this._els.slotList   = document.getElementById('dm-slot-list');
        document.getElementById('dm-slot-back')
            ?.addEventListener('click', () => this._closeSlotPanel());
    }


    _buildAudioPanel() {
        const el = this._createPanel('dm-audio-panel', `
            <div class="dm-panel__inner">
                <h2 class="dm-panel__title">— Audio —</h2>
                <div class="dm-audio-row">
                    <label>Música</label>
                    <input type="range" id="dm-slider-bgm" min="0" max="100" value="50">
                </div>
                <div class="dm-audio-row">
                    <label>Efectos</label>
                    <input type="range" id="dm-slider-se" min="0" max="100" value="80">
                </div>
                <div class="dm-audio-row">
                    <label>Voces</label>
                    <input type="range" id="dm-slider-voice" min="0" max="100" value="100">
                </div>
                <button class="btn-gold dm-panel__back" id="dm-audio-back">← Volver</button>
            </div>
        `);
        this._els.audioPanel   = el;
        this._els.sliderBGM    = document.getElementById('dm-slider-bgm');
        this._els.sliderSE     = document.getElementById('dm-slider-se');
        this._els.sliderVoice  = document.getElementById('dm-slider-voice');

        this._els.sliderBGM?.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            this.audio.setVolume('bgm', v);
            this.engine.state.audioSettings.bgmVolume = v;
        });
        this._els.sliderSE?.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            this.audio.setVolume('se', v);
            this.engine.state.audioSettings.sfxVolume = v;
        });
        this._els.sliderVoice?.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            this.audio.setVolume('voice', v);
            this.engine.state.audioSettings.voiceVolume = v;
        });
        document.getElementById('dm-audio-back')?.addEventListener('click', () => {
            this._closeAudio();
            this.saveManager.save(this.engine.state, 'autosave').catch(() => {});
        });
    }

    _buildModal() {
        if (document.getElementById('dm-modal')) return;
        const el = document.createElement('div');
        el.id = 'dm-modal';
        el.className = 'dm-overlay dm-modal dm-hidden';
        el.innerHTML = `
            <div class="dm-modal__box">
                <p class="dm-modal__msg" id="dm-modal-msg"></p>
                <div class="dm-modal__actions">
                    <button class="btn-gold" id="dm-modal-confirm"></button>
                    <button class="btn-gold" id="dm-modal-cancel"></button>
                </div>
            </div>`;
        document.body.appendChild(el);
        this._els.modal        = el;
        this._els.modalMsg     = document.getElementById('dm-modal-msg');
        this._els.modalConfirm = document.getElementById('dm-modal-confirm');
        this._els.modalCancel  = document.getElementById('dm-modal-cancel');
    }

    _buildLoadingOverlay() {
        if (document.getElementById('dm-loading')) return;
        const el = document.createElement('div');
        el.id = 'dm-loading';
        el.className = 'dm-overlay dm-loading dm-hidden';
        el.innerHTML = `<span id="dm-loading-msg">Cargando...</span>`;
        document.body.appendChild(el);
        this._els.loadingOverlay = el;
        this._els.loadingMsg     = document.getElementById('dm-loading-msg');
    }

    _buildToast() {
        if (document.getElementById('dm-toast')) return;
        const el = document.createElement('div');
        el.id = 'dm-toast';
        el.className = 'dm-toast dm-hidden';
        document.body.appendChild(el);
        this._els.toast = el;
    }

    /** Helper: crea un panel flotante vacío, lo appenda a body y lo devuelve. */
    _createPanel(id, innerHTML) {
        if (document.getElementById(id)) return document.getElementById(id);
        const el = document.createElement('div');
        el.id = id;
        el.className = 'dm-overlay dm-panel dm-hidden';
        el.innerHTML = innerHTML;
        document.body.appendChild(el);
        return el;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    _populateMenu() {
        if (this._els.menuTitle) this._els.menuTitle.textContent = this.gameTitle;
        if (this._els.menuSub)   this._els.menuSub.textContent   = this.gameSubtitle;
    }

    _bindEvents() {
        const on = (el, ev, fn) => el?.addEventListener(ev, fn);
        const S  = MenuSystem.STATES;

        // ── Menú principal ────────────────────────────────────────────────────
        on(this._els.btnNew,      'click', () => this._actionNewGame());
        // "Continuar" y "Cargar Partida" en menú principal: ambos abren slots (load)
        on(this._els.btnLoad,     'click', () => this._actionOpenSlots('load'));

        // ── HUD ───────────────────────────────────────────────────────────────
        on(this._els.btnBacklog, 'click', () => this._openBacklog());
        on(this._els.btnAuto, 'click', () => this._toggleAuto());
        on(this._els.btnSkip, 'click', () => this._triggerSkip());
        on(this._els.btnSave, 'click', () => this._actionQuickSave());
        on(this._els.btnPause, 'click', () => {
            if (this._state === S.IN_GAME) this._setState(S.PAUSED);
        });
        on(this._els.btnExit, 'click', () => this._actionExitDirect());

        // ── Pausa ─────────────────────────────────────────────────────────────
        on(this._els.btnResume, 'click', () => {
            if (this._state === S.PAUSED) this._setState(S.IN_GAME);
        });
        on(this._els.btnSaveSlot,  'click', () => this._actionOpenSlots('save'));
        on(this._els.btnLoadSlot,  'click', () => this._actionOpenSlots('load'));
        on(this._els.btnSettings,  'click', () => this._openAudio()); // Ajustes = Audio
        on(this._els.btnMainMenu,  'click', () => this._actionExitConfirm());

        // ── ESC ───────────────────────────────────────────────────────────────
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._handleEsc();
            if (e.key === 'l' || e.key === 'L') {
                if (this._isBacklogOpen()) this._closeBacklog();
                else this._openBacklog();
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIONES
    // ─────────────────────────────────────────────────────────────────────────

    async _actionNewGame() {
        if (this._busy) return;
        this._busy = true;

        // 1. Mostrar loading ANTES de cambiar estado — el canvas aún no tiene escena
        this._showLoading('Iniciando...');
        this.audio.unlock?.();

        // 2. Resetear el engine completamente — borra flags, inventario, sprites,
        //    backlog y todo el estado narrativo de una partida anterior.
        //    Nueva partida SIEMPRE empieza desde cero.
        this.engine.reset();

        // 3. Cargar todos los assets / escena
        await this.sceneManager.start(this.startScene);

        // 3. Ahora que el canvas tiene contenido, hacer transición de entrada
        this._hideLoading();
        this._setState(MenuSystem.STATES.IN_GAME);

        // 4. Fade-in del renderer si está disponible (da tiempo a PixiJS a renderizar)
        if (this.engine.renderer?.fadeIn) {
            await this.engine.renderer.fadeIn(400);
        }

        this._busy = false;
    }

async _actionOpenSlots(mode) {
        if (this._busy) return;
        // Esperar saves si aún están cargando
        if (this._savesReady) await this._savesReady;
        this._openSlotPanel(mode);
    }

    _actionQuickSave() {
        // Ya no hace quick-save ciego — abre el panel de slots para que
        // el jugador elija dónde guardar.
        this._actionOpenSlots('save');
    }

    async _actionExitDirect() {
        if (this._busy) return;
        this._busy = true;
        await this.engine.saveToSlot('autosave').catch(() => {});
        this._doExitToMenu();
        this._busy = false;
    }

    _actionExitConfirm() {
        this._showModal({
            message:      '¿Volver al menú principal?\nEl progreso no guardado se perderá.',
            confirmLabel: 'Salir',
            cancelLabel:  'Cancelar',
            onConfirm:    () => this._doExitToMenu(),
        });
    }

    _doExitToMenu() {
        this.audio.stopBGM(500);
        this._setState(MenuSystem.STATES.MAIN_MENU);
        this._savesReady = this._loadSaves();
    }



    _buildBacklogPanel() {
        const el = document.createElement('div');
        el.id = 'dm-backlog';
        el.className = 'dm-hidden';
        el.innerHTML = `
            <div class="dm-backlog__inner">
                <div class="dm-backlog__header">
                    <span class="dm-backlog__title">Historial</span>
                    <button class="dm-backlog__close" id="dm-backlog-close">✕</button>
                </div>
                <div class="dm-backlog__list" id="dm-backlog-list"></div>
            </div>`;
        document.body.appendChild(el);
        this._els.backlogPanel = el;
        this._els.backlogList  = el.querySelector('#dm-backlog-list');

        document.getElementById('dm-backlog-close')
            ?.addEventListener('click', () => this._closeBacklog());

        // Scroll con rueda también cierra si llega al tope superior
        el.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
    }

    _openBacklog() {
        if (this._state !== MenuSystem.STATES.IN_GAME) return;
        this._renderBacklog();
        this._els.backlogPanel?.classList.remove('dm-hidden');
    }

    _closeBacklog() {
        this._els.backlogPanel?.classList.add('dm-hidden');
    }

    _isBacklogOpen() {
        return this._els.backlogPanel && !this._els.backlogPanel.classList.contains('dm-hidden');
    }

    _renderBacklog() {
        if (!this._els.backlogList) return;
        const entries = this.engine.backlog ?? [];

        this._els.backlogList.innerHTML = entries
            .map(({ speaker, text }) => {
                if (speaker) {
                    return `<div class="dm-backlog__entry dm-backlog__entry--dialogue">
                        <span class="dm-backlog__speaker">${speaker}</span>
                        <span class="dm-backlog__text">${text}</span>
                    </div>`;
                } else {
                    return `<div class="dm-backlog__entry dm-backlog__entry--narrate">
                        <span class="dm-backlog__text dm-backlog__text--narrate">${text}</span>
                    </div>`;
                }
            })
            .join('');

        // Scroll al final — la última entrada es la más reciente
        this._els.backlogList.scrollTop = this._els.backlogList.scrollHeight;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PANEL DE SLOTS
    // ─────────────────────────────────────────────────────────────────────────

    async _actionDeleteSlot(slotId, slotName) {
        const ok = await this._confirmModal(
            `¿Eliminar ${slotName}? Esta acción no se puede deshacer.`,
            'Eliminar', 'Cancelar'
        );
        if (!ok) return;
        await this.saveManager.deleteSlot(slotId);
        await this._loadSaves();
        // Re-renderizar con los datos frescos
        this._renderSlots(this._slotMode);
        this._toast(`${slotName} eliminada`);
    }

    _openSlotPanel(mode) {
        if (this._els.slotTitle) {
            this._els.slotTitle.textContent = mode === 'save'
                ? '— Guardar Partida —'
                : '— Cargar Partida —';
        }
        this._renderSlots(mode);
        this._els.slotPanel?.classList.remove('dm-hidden');
    }

    _closeSlotPanel() {
        this._els.slotPanel?.classList.add('dm-hidden');
    }

    _renderSlots(mode) {
        if (!this._els.slotList) return;
        const SLOTS = ['autosave', 'slot_1', 'slot_2', 'slot_3'];
        const NAMES = {
            autosave: 'Autoguardado',
            slot_1:   'Ranura 1',
            slot_2:   'Ranura 2',
            slot_3:   'Ranura 3',
        };

        this._els.slotList.innerHTML = '';

        for (const slotId of SLOTS) {
            if (mode === 'save' && slotId === 'autosave') continue;

            const data = this._saves[slotId];
            const item = document.createElement('div');
            item.className = `dm-slot-item${data ? '' : ' dm-slot-item--empty'}`;

            const date = data?.savedAt
                ? new Date(data.savedAt).toLocaleDateString('es', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit' })
                : 'Vacío';

            // Botón eliminar — solo en slots con datos
            const deleteBtn = data ? `<button class="dm-slot-delete" title="Eliminar">✕</button>` : '';

            item.innerHTML = `
                <span class="dm-slot-name">${NAMES[slotId]}</span>
                <span class="dm-slot-meta">${date}</span>
                ${deleteBtn}`;

            // Clic en botón eliminar (no propaga al item)
            item.querySelector('.dm-slot-delete')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._actionDeleteSlot(slotId, NAMES[slotId]);
            });

            item.addEventListener('click', () =>
                this._onSlotClick(mode, slotId, NAMES[slotId], data));

            this._els.slotList.appendChild(item);
        }
    }

    async _onSlotClick(mode, slotId, slotName, data) {
        if (mode === 'save') {
            if (data) {
                const ok = await this._confirmModal(
                    `¿Sobrescribir ${slotName}?`, 'Guardar', 'Cancelar');
                if (!ok) return;
            }
            await this.engine.saveToSlot(slotId);
            await this._loadSaves();
            this._closeSlotPanel();
            this._toast('Partida guardada');

        } else {
            if (!data) return;
            this._closeAllPanels();
            this._busy = true;
            this._showLoading('Cargando partida...');
            this.audio.unlock?.();

            const target = data.currentFile.replace('.dan', '');
            const ok = await this.sceneManager.loadOnly(target);
            if (ok) {
                await this.engine.resumeFromState(data);
                await this.engine.next();
            }

            this._hideLoading();
            this._setState(MenuSystem.STATES.IN_GAME);
            if (this.engine.renderer?.fadeIn) await this.engine.renderer.fadeIn(400);
            this._busy = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PANELES SECUNDARIOS
    // ─────────────────────────────────────────────────────────────────────────


    _openAudio() {
        const s = this.engine.state.audioSettings;
        if (this._els.sliderBGM)   this._els.sliderBGM.value   = Math.round(s.bgmVolume   * 100);
        if (this._els.sliderSE)    this._els.sliderSE.value    = Math.round(s.sfxVolume   * 100);
        if (this._els.sliderVoice) this._els.sliderVoice.value = Math.round(s.voiceVolume * 100);
        this._els.audioPanel?.classList.remove('dm-hidden');
    }
    _closeAudio() {
        this._els.audioPanel?.classList.add('dm-hidden');
    }

    _closeAllPanels() {
        this._closeSlotPanel();
        this._closeAudio();
        this._closeModal();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ESC
    // ─────────────────────────────────────────────────────────────────────────

    _handleEsc() {
        if (this._isBacklogOpen()) { this._closeBacklog(); return; }
        const S = MenuSystem.STATES;
        if (this._state === S.MAIN_MENU || this._state === S.LOADING) return;

        if (this._isModalOpen())                                                  { this._closeModal();     return; }
        if (!this._els.audioPanel?.classList.contains('dm-hidden'))              { this._closeAudio();     return; }
        if (!this._els.slotPanel?.classList.contains('dm-hidden'))               { this._closeSlotPanel(); return; }
        if (this._state === S.PAUSED)  { this._setState(S.IN_GAME); return; }
        if (this._state === S.IN_GAME) { this._setState(S.PAUSED);  return; }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MODAL
    // ─────────────────────────────────────────────────────────────────────────

    _showModal({ message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
        this._els.modalMsg.textContent     = message;
        this._els.modalConfirm.textContent = confirmLabel;
        this._els.modalCancel.textContent  = cancelLabel;

        const nc = this._els.modalConfirm.cloneNode(true);
        const nx = this._els.modalCancel.cloneNode(true);
        this._els.modalConfirm.replaceWith(nc);
        this._els.modalCancel.replaceWith(nx);
        this._els.modalConfirm = nc;
        this._els.modalCancel  = nx;

        nc.addEventListener('click', () => { this._closeModal(); onConfirm(); });
        nx.addEventListener('click', () => { this._closeModal(); onCancel?.(); });
        this._els.modal?.classList.remove('dm-hidden');
    }

    _confirmModal(message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar') {
        return new Promise((resolve) => {
            this._showModal({
                message, confirmLabel, cancelLabel,
                onConfirm: () => resolve(true),
                onCancel:  () => resolve(false),
            });
        });
    }

    _closeModal() { this._els.modal?.classList.add('dm-hidden'); }
    _isModalOpen() { return !this._els.modal?.classList.contains('dm-hidden'); }

    // ─────────────────────────────────────────────────────────────────────────
    // LOADING
    // ─────────────────────────────────────────────────────────────────────────

    _showLoading(msg = 'Cargando...') {
        if (this._els.loadingMsg) this._els.loadingMsg.textContent = msg;
        this._els.loadingOverlay?.classList.remove('dm-hidden');
    }
    _hideLoading() {
        this._els.loadingOverlay?.classList.add('dm-hidden');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TOAST — notificación flotante en esquina, desaparece sola
    // ─────────────────────────────────────────────────────────────────────────

    _toast(msg) {
        if (!this._els.toast) return;
        this._els.toast.textContent = msg;
        this._els.toast.classList.remove('dm-hidden');
        this._els.toast.classList.add('dm-toast--visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this._els.toast.classList.remove('dm-toast--visible');
            // Esperar la transición CSS antes de ocultar del todo
            setTimeout(() => this._els.toast.classList.add('dm-hidden'), 300);
        }, 2500);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVES
    // ─────────────────────────────────────────────────────────────────────────

    async _loadSaves() {
        const SLOTS = ['autosave', 'slot_1', 'slot_2', 'slot_3'];
        await Promise.all(SLOTS.map(async (id) => {
            this._saves[id] = await this.saveManager.load(id);
        }));
        this._autosave = this._saves['autosave'];
        this._updateMainMenuButtons();
    }

    _updateMainMenuButtons() {
        const hasSaves = Object.values(this._saves).some(Boolean);
        // "Cargar Partida" — activo si hay cualquier save
        if (this._els.btnLoad)
            this._els.btnLoad.disabled = !hasSaves;
    }
}
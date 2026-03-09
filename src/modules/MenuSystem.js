// src/modules/MenuSystem.js
//
// RESPONSABILIDADES:
//   - Splash screen / Menú principal
//   - Menú de pausa (ESC o botón HUD)
//   - Panel de ajustes de audio
//   - Selector de slots (guardar / cargar)
//   - Exportar / importar partida
//
// INYECCIÓN (en main.js):
//   const menu = new MenuSystem({ engine, saveManager, sceneManager, audio });
//   await menu.init();  ← muestra el menú principal

export class MenuSystem {

    /**
     * @param {object} deps
     * @param {Dramaturge}  deps.engine
     * @param {SaveManager}  deps.saveManager
     * @param {SceneManager} deps.sceneManager
     * @param {Audio}      deps.audio
     * @param {string}       deps.startScene   - Escena inicial (ej: 'cap01/scene_01')
     * @param {string}       deps.gameTitle     - Título del juego
     * @param {string}       deps.gameSubtitle  - Subtítulo / tagline
     */
    constructor({ engine, saveManager, sceneManager, audio,
                  startScene = 'cap01/scene_01',
                  gameTitle  = 'EMERS',
                  gameSubtitle = 'Novela Visual' }) {

        this.engine       = engine;
        this.saveManager  = saveManager;
        this.sceneManager = sceneManager;
        this.audio        = audio;
        this.startScene   = startScene;
        this.gameTitle    = gameTitle;
        this.gameSubtitle = gameSubtitle;

        this._slotMode    = 'load'; // 'load' | 'save'
        this._busy        = false;  // guarda contra re-entrada en acciones de menú
        this._panelOpen   = false;  // true mientras audio/slots están abiertos

        // Caché precargada durante init() — los paneles muestran datos ya listos
        this._cachedSaves = {};     // { autosave, slot_1, slot_2, slot_3 }
        this._autosave    = null;   // GameState | null

        // Referencias DOM — pobladas en init()
        this._els = {};
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN
    // ─────────────────────────────────────────────────────────────────────────

    async init() {
        this._bindEls();
        this._populateMenu();

        // Precargar todos los saves ANTES de mostrar el menú.
        // Así los paneles de slots y "Continuar" son instantáneos.
        await this._preloadSaves();

        this._bindEvents();
        this._showMainMenu();
    }

    /**
     * Carga todos los slots desde Dexie y los guarda en caché.
     * Se llama una vez en init() y cada vez que se guarda/carga una partida.
     */
    async _preloadSaves() {
        const SLOTS = ['autosave', 'slot_1', 'slot_2', 'slot_3'];
        await Promise.all(SLOTS.map(async (slotId) => {
            this._cachedSaves[slotId] = await this.saveManager.load(slotId);
        }));
        this._autosave = this._cachedSaves['autosave'];

        // Actualizar estado del botón "Continuar"
        if (this._els.btnContinue) {
            this._els.btnContinue.disabled = !this._autosave;
        }
    }

    _bindEls() {
        const $ = (id) => document.getElementById(id);

        this._els = {
            // Menú principal
            mainMenu:    $('main-menu'),
            menuTitle:   $('menu-title'),
            menuSub:     $('menu-subtitle'),
            btnNew:      $('btn-new-game'),
            btnContinue: $('btn-continue'),
            btnLoad:     $('btn-load'),
            btnAudio:    $('btn-audio-main'),
            // HUD en juego
            hud:         $('hud'),
            btnSave:     $('btn-save'),
            btnPause:    $('btn-pause'),
            btnExit:     $('btn-exit'),

            // Pausa
            pauseMenu:   $('pause-menu'),
            btnResume:   $('btn-resume'),
            btnSaveSlot: $('btn-save-slot'),
            btnLoadSlot: $('btn-load-slot'),
            btnAudioP:   $('btn-audio-pause'),
            btnExportP:  $('btn-export-pause'),
            btnImportP:  $('btn-import-pause'),
            btnMainMenu: $('btn-main-menu'),

            // Audio
            audioPanel:  $('audio-panel'),
            sliderBGM:   $('slider-bgm'),
            sliderSE:    $('slider-se'),
            sliderVoice: $('slider-voice'),
            btnAudioBack:$('btn-audio-back'),

            // Slots
            slotPanel:   $('slot-panel'),
            slotTitle:   $('slot-panel-title'),
            slotList:    $('slot-list'),
            btnSlotBack: $('btn-slot-back'),
        };
    }

    _populateMenu() {
        if (this._els.menuTitle)  this._els.menuTitle.textContent  = this.gameTitle;
        if (this._els.menuSub)    this._els.menuSub.textContent    = this.gameSubtitle;
    }



    _bindEvents() {
        const on = (el, ev, fn) => el?.addEventListener(ev, fn);

        // ── Menú principal ────────────────────────────────────────────────────
        on(this._els.btnNew,      'click', () => this._newGame());
        on(this._els.btnContinue, 'click', () => this._continueGame());
        on(this._els.btnLoad,     'click', () => { if (!this._busy && !this._panelOpen) this._openSlots('load'); });
        // ── HUD ───────────────────────────────────────────────────────────────
        on(this._els.btnSave,  'click', () => this._quickSave());
        on(this._els.btnPause, 'click', () => this._openPause());
        on(this._els.btnExit,  'click', () => this._exitToMenu());

        // ── Pausa ─────────────────────────────────────────────────────────────
        on(this._els.btnResume,   'click', () => this._closePause());
        on(this._els.btnSaveSlot, 'click', () => { if (!this._busy && !this._panelOpen) this._openSlots('save'); });
        on(this._els.btnLoadSlot, 'click', () => { if (!this._busy && !this._panelOpen) this._openSlots('load'); });
        on(this._els.btnAudioP,   'click', () => { if (!this._busy && !this._panelOpen) this._openAudio(); });
        on(this._els.btnExportP,  'click', () => this._export());
        on(this._els.btnImportP,  'click', () => this._import());
        on(this._els.btnMainMenu, 'click', () => { if (!this._busy) this._exitToMenu(); });

        // ── Audio ─────────────────────────────────────────────────────────────
        on(this._els.sliderBGM, 'input', (e) => {
            const v = e.target.value / 100;
            this.audio.setVolume('bgm', v);
            this.engine.state.audioSettings.bgmVolume = v;
        });
        on(this._els.sliderSE, 'input', (e) => {
            const v = e.target.value / 100;
            this.audio.setVolume('se', v);
            this.engine.state.audioSettings.sfxVolume = v;
        });
        on(this._els.sliderVoice, 'input', (e) => {
            const v = e.target.value / 100;
            this.audio.setVolume('voice', v);
            this.engine.state.audioSettings.voiceVolume = v;
        });
        on(this._els.btnAudioBack, 'click', () => this._closeAudio());

        // ── Slots ─────────────────────────────────────────────────────────────
        on(this._els.btnSlotBack, 'click', () => this._closeSlots());

        // ── ESC key ───────────────────────────────────────────────────────────
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (this._isMenuVisible())   return;
            if (this._isAudioVisible())  { this._closeAudio();  return; }
            if (this._isSlotsVisible())  { this._closeSlots();  return; }
            if (this._isPauseVisible())  { this._closePause();  return; }
            this._openPause();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIONES
    // ─────────────────────────────────────────────────────────────────────────

    async _newGame() {
        if (this._busy) return;
        this._busy = true;           // inmediato — antes de cualquier await
        this._disableMenuButtons();
        this._hideMainMenu();
        this._showHUD();
        this.audio.unlock?.();
        await this.sceneManager.start(this.startScene);
        this._busy = false;
    }

    async _continueGame() {
        if (this._busy || !this._autosave) return;
        this._busy = true;
        this._disableMenuButtons();

        this._hideMainMenu();
        this._showHUD();
        this.audio.unlock?.();

        // Usar el autosave ya precargado — sin queries a Dexie en el clic
        const target = this._autosave.currentFile.replace('.dan', '');
        const ok = await this.sceneManager.loadOnly(target);
        if (ok) {
            await this.engine.resumeFromState(this._autosave);
            await this.engine.next();
        }
        this._busy = false;
    }

    _quickSave() {
        this.engine.saveToSlot('slot_1').then(() => {
            this._flashHUDSave();
        });
    }

    _export() {
        this.engine.exportSave();
    }

    async _import() {
        const loaded = await this.saveManager.importFromFile();
        if (!loaded) return;
        this._hideMainMenu();
        this._closePause();
        this._showHUD();
        await this.sceneManager.start(loaded.currentFile.replace('.dan', ''));
        await this.engine.resumeFromState(loaded);
    }

    _exitToMenu() {
        this.audio.stopBGM(500);
        this._closePause();
        this._hideHUD();
        this._showMainMenu();
        this._enableMenuButtons();
        // Refrescar caché por si hay un nuevo autosave
        this._preloadSaves();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PANEL DE AUDIO
    // ─────────────────────────────────────────────────────────────────────────

    _openAudio() {
        this._panelOpen = true;
        // Sincronizar sliders con el state actual
        const s = this.engine.state.audioSettings;
        if (this._els.sliderBGM)   this._els.sliderBGM.value   = Math.round(s.bgmVolume   * 100);
        if (this._els.sliderSE)    this._els.sliderSE.value    = Math.round(s.sfxVolume   * 100);
        if (this._els.sliderVoice) this._els.sliderVoice.value = Math.round(s.voiceVolume * 100);

        this._els.audioPanel?.classList.add('visible');
    }

    _closeAudio() {
        this._panelOpen = false;
        this._els.audioPanel?.classList.remove('visible');
        // Persistir los ajustes de audio
        this.saveManager.save(this.engine.state, 'autosave').catch(() => {});
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SELECTOR DE SLOTS
    // ─────────────────────────────────────────────────────────────────────────

    _openSlots(mode) {
        this._slotMode  = mode;
        this._panelOpen = true;

        if (this._els.slotTitle) {
            this._els.slotTitle.textContent = mode === 'save'
                ? 'Guardar Partida'
                : 'Cargar Partida';
        }

        // _renderSlots es síncrono (usa caché) — panel e items aparecen juntos
        this._renderSlots(mode);
        this._els.slotPanel?.classList.add('visible');
    }

    _closeSlots() {
        this._panelOpen = false;
        this._els.slotPanel?.classList.remove('visible');
    }

    /**
     * Renderiza los slots usando la caché — sin queries a Dexie.
     * La caché se refresca después de guardar o cargar.
     */
    _renderSlots(mode) {
        if (!this._els.slotList) return;

        const SLOTS      = ['autosave', 'slot_1', 'slot_2', 'slot_3'];
        const SLOT_NAMES = {
            autosave: 'Autoguardado',
            slot_1:   'Ranura 1',
            slot_2:   'Ranura 2',
            slot_3:   'Ranura 3',
        };

        this._els.slotList.innerHTML = '';

        for (const slotId of SLOTS) {
            if (mode === 'save' && slotId === 'autosave') continue;

            const data = this._cachedSaves[slotId]; // ← caché, sin await
            const item = document.createElement('div');
            item.className = `slot-item ${data ? '' : 'slot-item--empty'}`;

            const date = data?.savedAt
                ? new Date(data.savedAt).toLocaleDateString('es', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })
                : 'Vacío';

            item.innerHTML = `
                <span class="slot-name">${SLOT_NAMES[slotId]}</span>
                <span class="slot-meta">${date}</span>
            `;

            item.addEventListener('click', async () => {
                if (mode === 'save') {
                    await this.engine.saveToSlot(slotId);
                    // Refrescar caché tras guardar
                    await this._preloadSaves();
                    this._closeSlots();
                } else {
                    if (!data) return;
                    this._closeSlots();
                    this._closePause();
                    const target = data.currentFile.replace('.dan', '');
                    const ok = await this.sceneManager.loadOnly(target);
                    if (ok) {
                        await this.engine.resumeFromState(data);
                        await this.engine.next();
                    }
                    // Refrescar caché tras cargar
                    await this._preloadSaves();
                }
            });

            this._els.slotList.appendChild(item);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PAUSA
    // ─────────────────────────────────────────────────────────────────────────

    _openPause() {
        this.engine.isBlocked = true;
        this._els.pauseMenu?.classList.add('visible');
    }

    _closePause() {
        this._els.pauseMenu?.classList.remove('visible');
        this.engine.isBlocked = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VISIBILIDAD
    // ─────────────────────────────────────────────────────────────────────────

    _showMainMenu()  { this._els.mainMenu?.classList.remove('hidden'); }
    _hideMainMenu()  { this._els.mainMenu?.classList.add('hidden'); }
    _showHUD()       { this._els.hud?.classList.add('visible'); }
    _hideHUD()       { this._els.hud?.classList.remove('visible'); }

    _isMenuVisible()  { return !this._els.mainMenu?.classList.contains('hidden'); }
    _isPauseVisible() { return this._els.pauseMenu?.classList.contains('visible'); }
    _isAudioVisible() { return this._els.audioPanel?.classList.contains('visible'); }
    _isSlotsVisible() { return this._els.slotPanel?.classList.contains('visible'); }

    /** Deshabilita todos los botones del menú principal durante acciones async */
    _disableMenuButtons() {
        [this._els.btnNew, this._els.btnContinue,
         this._els.btnLoad].forEach(b => {
            if (b) b.disabled = true;
        });
    }

    /** Rehabilita los botones (salvo "Continuar" si no hay autosave) */
    _enableMenuButtons() {
        [this._els.btnNew, this._els.btnLoad].forEach(b => {
            if (b) b.disabled = false;
        });
        this._checkContinue(); // revalida el estado real de "Continuar"
    }

    /** Feedback visual rápido en el botón de guardado */
    _flashHUDSave() {
        const btn = this._els.btnSave;
        if (!btn) return;
        btn.textContent = '✓ Guardado';
        setTimeout(() => { btn.textContent = 'Guardar'; }, 1500);
    }
}
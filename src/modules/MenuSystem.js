// src/modules/MenuSystem.js

import { SlotPanel }    from './panels/SlotPanel.js';
import { AudioPanel }   from './panels/AudioPanel.js';
import { BacklogPanel } from './panels/BacklogPanel.js';
import { GalleryPanel } from './panels/GalleryPanel.js';
import { ModalPanel }   from './panels/ModalPanel.js';

/**
 * @typedef {'MAIN_MENU' | 'LOADING' | 'IN_GAME' | 'PAUSED'} MenuState
 */

/**
 * @typedef {Object} MenuSystemConfig
 * @property {import('../core/Engine.js').Dramaturge}         engine
 * @property {import('../core/SaveManager.js').SaveManager}   saveManager
 * @property {import('../core/SceneManager.js').SceneManager} sceneManager
 * @property {import('../modules/Audio.js').AudioManager}     audio
 * @property {string} startScene
 * @property {string} gameTitle
 * @property {string} gameSubtitle
 */

/**
 * @typedef {Object} SlotRecord
 * @property {string}      slotId
 * @property {string}      displayName
 * @property {number|null} savedAt
 * @property {string|null} currentFile
 */

/**
 * Orquestador principal del flujo de menús y estado de la aplicación.
 *
 * Responsabilidad única: coordinar la máquina de estados, los paneles
 * y los módulos del engine. No construye DOM — delega en los paneles.
 *
 * Estados posibles:
 *   MAIN_MENU → LOADING → IN_GAME ↔ PAUSED
 */
export class MenuSystem {

    static STATES = /** @type {Record<MenuState, MenuState>} */ ({
        MAIN_MENU: 'MAIN_MENU',
        LOADING:   'LOADING',
        IN_GAME:   'IN_GAME',
        PAUSED:    'PAUSED',
    });

    static #SLOT_IDS = ['autosave', 'slot_1', 'slot_2', 'slot_3'];

    static #SLOT_DISPLAY_NAMES = {
        autosave: 'Autoguardado',
        slot_1:   'Ranura 1',
        slot_2:   'Ranura 2',
        slot_3:   'Ranura 3',
    };

    // ── Dependencias ───────────────────────────────────────────────────────

    /** @type {import('../core/Engine.js').Dramaturge} */
    #engine;

    /** @type {import('../core/SaveManager.js').SaveManager} */
    #saveManager;

    /** @type {import('../core/SceneManager.js').SceneManager} */
    #sceneManager;

    /** @type {import('../modules/Audio.js').AudioManager} */
    #audio;

    // ── Configuración ──────────────────────────────────────────────────────

    /** @type {string} */
    #startScene;

    /** @type {string} */
    #gameTitle;

    /** @type {string} */
    #gameSubtitle;

    // ── Estado interno ─────────────────────────────────────────────────────

    /** @type {MenuState} */
    #currentState = null;

    /** @type {boolean} — bloquea acciones mientras una operación async está en curso */
    #isBusy = false;

    /** @type {Record<string, SlotRecord|null>} */
    #cachedSlots = {};

    /** @type {Promise<void>|null} */
    #slotLoadingPromise = null;

    // ── Paneles ────────────────────────────────────────────────────────────

    /** @type {SlotPanel} */
    #slotPanel;

    /** @type {AudioPanel} */
    #audioPanel;

    /** @type {BacklogPanel} */
    #backlogPanel;

    /** @type {GalleryPanel} */
    #galleryPanel;

    /** @type {ModalPanel} */
    #modalPanel;

    // ── Elementos estáticos del DOM (existen en index.html) ───────────────

    /** @type {Record<string, HTMLElement|null>} */
    #staticElements = {};

    // ── Temporizadores ─────────────────────────────────────────────────────

    /** @type {ReturnType<typeof setInterval>|null} */
    #hudClockInterval = null;

    /** @type {ReturnType<typeof setTimeout>|null} */
    #toastTimer = null;

    /** @param {MenuSystemConfig} config */
    constructor(config) {
        this.#engine       = config.engine;
        this.#saveManager  = config.saveManager;
        this.#sceneManager = config.sceneManager;
        this.#audio        = config.audio;
        this.#startScene   = config.startScene;
        this.#gameTitle    = config.gameTitle;
        this.#gameSubtitle = config.gameSubtitle;
    }

    // ── API pública ────────────────────────────────────────────────────────

    /** @returns {MenuState} */
    get state() { return this.#currentState; }

    /** @returns {boolean} */
    get backlogOpen() { return this.#backlogPanel?.isOpen ?? false; }

    async init() {
        this.#bindStaticElements();
        this.#mountPanels();
        this.#populateStaticMenuContent();
        this.#bindAllEvents();
        this.#transitionToState(MenuSystem.STATES.MAIN_MENU);
        this.#slotLoadingPromise = this.#loadAllSlots();
    }

    // ── Máquina de estados ─────────────────────────────────────────────────

    /** @param {MenuState} newState */
    #transitionToState(newState) {
        this.#currentState = newState;
        const states = MenuSystem.STATES;

        this.#staticElements.mainMenu?.classList.add('hidden');
        this.#staticElements.hud?.classList.remove('visible');
        this.#staticElements.pauseMenu?.classList.remove('visible');
        this.#engine.isBlocked = false;

        switch (newState) {
            case states.MAIN_MENU:
                this.#staticElements.mainMenu?.classList.remove('hidden');
                this.#stopHudClock();
                this.#refreshMainMenuButtonStates();
                break;

            case states.LOADING:
                break;

            case states.IN_GAME:
                this.#staticElements.hud?.classList.add('visible');
                this.#updateHudSceneInfo();
                this.#startHudClock();
                this.#audio.pauseUnduck?.();
                break;

            case states.PAUSED:
                this.#staticElements.hud?.classList.add('visible');
                this.#staticElements.pauseMenu?.classList.add('visible');
                this.#engine.isBlocked = true;
                this.#engine.stopModes?.();
                this.#staticElements.btnAuto?.classList.remove('hud-btn--active');
                this.#staticElements.btnSkip?.classList.remove('hud-btn--active');
                this.#audio.pauseDuck?.();
                break;
        }
    }

    // ── Binding de elementos estáticos ─────────────────────────────────────

    #bindStaticElements() {
        const byId = (id) => document.getElementById(id);

        this.#staticElements = {
            mainMenu:     byId('main-menu'),
            menuTitle:    byId('menu-title'),
            menuSubtitle: byId('menu-subtitle'),
            btnNewGame:   byId('btn-new-game'),
            btnLoadGame:  byId('btn-load'),
            btnGallery:   byId('btn-gallery'),

            hud:          byId('hud'),
            btnSave:      byId('btn-save'),
            btnPause:     byId('btn-pause'),
            btnExit:      byId('btn-exit'),
            btnBacklog:   byId('btn-backlog'),
            btnAuto:      byId('btn-auto'),
            btnSkip:      byId('btn-skip'),
            hudTitle:     byId('hud-title'),
            hudScene:     byId('hud-scene'),
            hudPlaytime:  byId('hud-playtime'),

            pauseMenu:    byId('pause-menu'),
            btnResume:    byId('btn-resume'),
            btnSaveSlot:  byId('btn-save-slot'),
            btnLoadSlot:  byId('btn-load-slot'),
            btnSettings:  byId('btn-settings'),
            btnMainMenu:  byId('btn-main-menu'),

            loadingOverlay: null,
            loadingMessage: null,
            toastElement:   null,
        };

        this.#buildLoadingOverlay();
        this.#buildToastElement();
    }

    // ── Montaje de paneles ─────────────────────────────────────────────────

    #mountPanels() {
        this.#slotPanel = new SlotPanel([], {
            onSaveRequested:   (slotId) => this.#handleSaveToSlot(slotId),
            onLoadRequested:   (slotId) => this.#handleLoadFromSlot(slotId),
            onDeleteRequested: (slotId, displayName) => this.#handleDeleteSlot(slotId, displayName),
            onClose:           () => this.#slotPanel.hide(),
        });

        this.#audioPanel = new AudioPanel({
            onVolumeChanged: (channel, volume) => this.#handleVolumeChange(channel, volume),
            onClose:         () => {
                this.#audioPanel.hide();
                this.#saveManager.save(this.#engine.state, 'autosave').catch(() => {});
            },
        });

        this.#backlogPanel = new BacklogPanel({
            onClose: () => this.#backlogPanel.hide(),
        });

        this.#galleryPanel = new GalleryPanel({
            onClose: () => this.#galleryPanel.hide(),
        });

        this.#modalPanel = new ModalPanel();

        this.#slotPanel.mount(document.body);
        this.#audioPanel.mount(document.body);
        this.#backlogPanel.mount(document.body);
        this.#galleryPanel.mount(document.body);
        this.#modalPanel.mount(document.body);
    }

    // ── Binding de eventos ─────────────────────────────────────────────────

    #bindAllEvents() {
        this.#bindMainMenuEvents();
        this.#bindHudEvents();
        this.#bindPauseMenuEvents();
        this.#bindKeyboardEvents();
    }

    #bindMainMenuEvents() {
        const on = (element, handler) => element?.addEventListener('click', handler);

        on(this.#staticElements.btnNewGame, () => this.#startNewGame());
        on(this.#staticElements.btnGallery, () => this.#openGallery());
        on(this.#staticElements.btnLoadGame, () => this.#openSlotsForLoading());
    }

    #bindHudEvents() {
        const on = (element, handler) => element?.addEventListener('click', handler);
        const states = MenuSystem.STATES;

        on(this.#staticElements.btnBacklog, () => this.#openBacklog());
        on(this.#staticElements.btnAuto,    () => this.#toggleAutoMode());
        on(this.#staticElements.btnSkip,    () => this.#triggerSkipMode());
        on(this.#staticElements.btnSave,    () => this.#openSlotsForSaving());
        on(this.#staticElements.btnPause,   () => {
            if (this.#currentState === states.IN_GAME) {
                this.#transitionToState(states.PAUSED);
            }
        });
        on(this.#staticElements.btnExit, () => this.#exitToMainMenuWithAutosave());
    }

    #bindPauseMenuEvents() {
        const on = (element, handler) => element?.addEventListener('click', handler);
        const states = MenuSystem.STATES;

        on(this.#staticElements.btnResume, () => {
            if (this.#currentState === states.PAUSED) {
                this.#transitionToState(states.IN_GAME);
            }
        });
        on(this.#staticElements.btnSaveSlot,  () => this.#openSlotsForSaving());
        on(this.#staticElements.btnLoadSlot,  () => this.#openSlotsForLoading());
        on(this.#staticElements.btnSettings,  () => this.#openAudioPanel());
        on(this.#staticElements.btnMainMenu,  () => this.#confirmExitToMainMenu());
    }

    #bindKeyboardEvents() {
        document.addEventListener('keydown', (keyboardEvent) => {
            this.#handleKeyboardInput(keyboardEvent);
        });
    }

    /** @param {KeyboardEvent} keyboardEvent */
    #handleKeyboardInput(keyboardEvent) {
        if (keyboardEvent.key === 'Escape')      { this.#handleEscapeKey();       return; }
        if (keyboardEvent.key === 'ArrowLeft')   { this.#galleryPanel.navigateLightbox(-1); return; }
        if (keyboardEvent.key === 'ArrowRight')  { this.#galleryPanel.navigateLightbox(1);  return; }
        if (keyboardEvent.key === 'l' || keyboardEvent.key === 'L') {
            this.#backlogPanel.isOpen
                ? this.#backlogPanel.hide()
                : this.#openBacklog();
        }
    }

    // ── Acciones principales ───────────────────────────────────────────────

    async #startNewGame() {
        if (this.#isBusy) return;
        this.#isBusy = true;

        this.#showLoadingOverlay('Iniciando...');
        this.#audio.unlock?.();
        this.#engine.reset();

        await this.#sceneManager.start(this.#startScene);

        this.#hideLoadingOverlay();
        this.#transitionToState(MenuSystem.STATES.IN_GAME);

        if (this.#engine.renderer?.fadeIn) {
            await this.#engine.renderer.fadeIn(400);
        }

        this.#isBusy = false;
    }

    async #openSlotsForSaving() {
        if (this.#isBusy) return;
        await this.#slotLoadingPromise;
        this.#slotPanel.open('save', this.#buildSlotDataArray());
    }

    async #openSlotsForLoading() {
        if (this.#isBusy) return;
        await this.#slotLoadingPromise;
        this.#slotPanel.open('load', this.#buildSlotDataArray());
    }

    async #openGallery() {
        const unlockedEntries = await this.#saveManager.db.gallery
            ?.orderBy('unlockedAt').toArray() ?? [];
        this.#galleryPanel.open(unlockedEntries);
    }

    #openBacklog() {
        if (this.#currentState !== MenuSystem.STATES.IN_GAME) return;
        this.#backlogPanel.open(this.#engine.backlog ?? []);
    }

    #openAudioPanel() {
        this.#audioPanel.open(this.#engine.state.audioSettings);
    }

    async #exitToMainMenuWithAutosave() {
        if (this.#isBusy) return;
        this.#isBusy = true;
        await this.#engine.saveToSlot('autosave').catch(() => {});
        this.#returnToMainMenu();
        this.#isBusy = false;
    }

    async #confirmExitToMainMenu() {
        const playerConfirmed = await this.#modalPanel.prompt({
            message:      '¿Volver al menú principal?\nEl progreso no guardado se perderá.',
            confirmLabel: 'Salir',
            cancelLabel:  'Cancelar',
        });
        if (playerConfirmed) this.#returnToMainMenu();
    }

    #returnToMainMenu() {
        this.#audio.stopBGM(500);
        this.#transitionToState(MenuSystem.STATES.MAIN_MENU);
        this.#slotLoadingPromise = this.#loadAllSlots();
    }

    // ── Handlers de paneles ────────────────────────────────────────────────

    /** @param {string} slotId */
    async #handleSaveToSlot(slotId) {
        const slotDisplayName    = MenuSystem.#SLOT_DISPLAY_NAMES[slotId];
        const slotAlreadyHasData = this.#cachedSlots[slotId] !== null;

        if (slotAlreadyHasData) {
            const playerConfirmed = await this.#modalPanel.prompt({
                message:      `¿Sobrescribir ${slotDisplayName}?`,
                confirmLabel: 'Guardar',
                cancelLabel:  'Cancelar',
            });
            if (!playerConfirmed) return;
        }

        await this.#engine.saveToSlot(slotId);
        await this.#loadAllSlots();
        this.#slotPanel.hide();
        this.#showToast('Partida guardada');
    }

    /** @param {string} slotId */
    async #handleLoadFromSlot(slotId) {
        const savedState = this.#cachedSlots[slotId];
        if (!savedState) return;

        this.#slotPanel.hide();
        this.#isBusy = true;
        this.#showLoadingOverlay('Cargando partida...');
        this.#audio.unlock?.();

        const sceneTarget = savedState.currentFile.replace('.dan', '');
        const sceneLoaded = await this.#sceneManager.loadOnly(sceneTarget);

        if (sceneLoaded) {
            await this.#engine.resumeFromState(savedState);
            await this.#engine.next();
        }

        this.#hideLoadingOverlay();
        this.#transitionToState(MenuSystem.STATES.IN_GAME);

        if (this.#engine.renderer?.fadeIn) {
            await this.#engine.renderer.fadeIn(400);
        }

        this.#isBusy = false;
    }

    /**
     * @param {string} slotId
     * @param {string} displayName
     */
    async #handleDeleteSlot(slotId, displayName) {
        const playerConfirmed = await this.#modalPanel.prompt({
            message:      `¿Eliminar ${displayName}? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            cancelLabel:  'Cancelar',
        });
        if (!playerConfirmed) return;

        await this.#saveManager.deleteSlot(slotId);
        await this.#loadAllSlots();
        this.#slotPanel.open(this.#slotPanel.currentMode, this.#buildSlotDataArray());
        this.#showToast(`${displayName} eliminada`);
    }

    /**
     * @param {'bgm' | 'se' | 'voice'} channel
     * @param {number}                  volume
     */
    #handleVolumeChange(channel, volume) {
        this.#audio.setVolume(channel, volume);

        const audioSettings = this.#engine.state.audioSettings;
        if (channel === 'bgm')   audioSettings.bgmVolume   = volume;
        if (channel === 'se')    audioSettings.sfxVolume   = volume;
        if (channel === 'voice') audioSettings.voiceVolume = volume;
    }

    // ── Modos de lectura ───────────────────────────────────────────────────

    #toggleAutoMode() {
        const autoIsNowActive = this.#engine.toggleAuto();
        this.#staticElements.btnAuto?.classList.toggle('hud-btn--active', autoIsNowActive);
        this.#staticElements.btnSkip?.classList.remove('hud-btn--active');
    }

    #triggerSkipMode() {
        const skipButton    = this.#staticElements.btnSkip;
        const skipIsNowActive = this.#engine.triggerSkip(() => {
            skipButton?.classList.remove('hud-btn--active');
        });
        skipButton?.classList.toggle('hud-btn--active', skipIsNowActive);
        if (skipIsNowActive) {
            this.#staticElements.btnAuto?.classList.remove('hud-btn--active');
        }
    }

    // ── Tecla Escape ──────────────────────────────────────────────────────

    #handleEscapeKey() {
        const states = MenuSystem.STATES;

        if (this.#galleryPanel.isOpen ?? false) { this.#galleryPanel.hide();  return; }
        if (this.#backlogPanel.isOpen)          { this.#backlogPanel.hide();  return; }
        if (this.#currentState === states.MAIN_MENU) return;
        if (this.#currentState === states.LOADING)   return;
        if (this.#modalPanel.isOpen)            { this.#modalPanel.hide();    return; }

        const audioIsOpen = !document.getElementById('dm-audio-panel')
            ?.classList.contains('dm-hidden');
        if (audioIsOpen) { this.#audioPanel.hide(); return; }

        const slotIsOpen = !document.getElementById('dm-slot-panel')
            ?.classList.contains('dm-hidden');
        if (slotIsOpen) { this.#slotPanel.hide(); return; }

        if (this.#currentState === states.PAUSED)  { this.#transitionToState(states.IN_GAME); return; }
        if (this.#currentState === states.IN_GAME) { this.#transitionToState(states.PAUSED);  return; }
    }

    // ── HUD ────────────────────────────────────────────────────────────────

    #updateHudSceneInfo() {
        if (this.#staticElements.hudTitle) {
            this.#staticElements.hudTitle.textContent = this.#gameTitle;
        }

        const currentSceneFile  = this.#engine.state.currentFile ?? '';
        const formattedSceneName = currentSceneFile
            .replace('.dan', '')
            .split('/')
            .map(segment => segment.replace(/_/g, ' ').replace(/\w/g, char => char.toUpperCase()))
            .join(' · ');

        if (this.#staticElements.hudScene) {
            this.#staticElements.hudScene.textContent = formattedSceneName;
        }
    }

    #startHudClock() {
        this.#stopHudClock();
        this.#hudClockInterval = setInterval(() => {
            if (this.#currentState !== MenuSystem.STATES.IN_GAME) return;

            const accumulatedPlaytime = (this.#engine.state.playTime ?? 0) +
                Math.floor((Date.now() - (this.#engine._sessionStart ?? Date.now())) / 1000);

            const hours   = Math.floor(accumulatedPlaytime / 3600);
            const minutes = Math.floor((accumulatedPlaytime % 3600) / 60)
                .toString().padStart(2, '0');
            const seconds = (accumulatedPlaytime % 60)
                .toString().padStart(2, '0');

            const formattedTime = hours > 0
                ? `${hours}:${minutes}:${seconds}`
                : `${minutes}:${seconds}`;

            if (this.#staticElements.hudPlaytime) {
                this.#staticElements.hudPlaytime.textContent = formattedTime;
            }
        }, 1000);
    }

    #stopHudClock() {
        clearInterval(this.#hudClockInterval);
        this.#hudClockInterval = null;
    }

    // ── Slots ──────────────────────────────────────────────────────────────

    async #loadAllSlots() {
        await Promise.all(
            MenuSystem.#SLOT_IDS.map(async (slotId) => {
                this.#cachedSlots[slotId] = await this.#saveManager.load(slotId);
            })
        );
        this.#refreshMainMenuButtonStates();
    }

    /** @returns {SlotRecord[]} */
    #buildSlotDataArray() {
        return MenuSystem.#SLOT_IDS.map(slotId => ({
            slotId,
            displayName: MenuSystem.#SLOT_DISPLAY_NAMES[slotId],
            savedAt:     this.#cachedSlots[slotId]?.savedAt     ?? null,
            currentFile: this.#cachedSlots[slotId]?.currentFile ?? null,
        }));
    }

    #refreshMainMenuButtonStates() {
        const anySlotHasData = Object.values(this.#cachedSlots).some(Boolean);
        if (this.#staticElements.btnLoadGame) {
            this.#staticElements.btnLoadGame.disabled = !anySlotHasData;
        }
    }

    // ── Contenido estático del menú ────────────────────────────────────────

    #populateStaticMenuContent() {
        if (this.#staticElements.menuTitle) {
            this.#staticElements.menuTitle.textContent = this.#gameTitle;
        }
        if (this.#staticElements.menuSubtitle) {
            this.#staticElements.menuSubtitle.textContent = this.#gameSubtitle;
        }
    }

    // ── Loading overlay ────────────────────────────────────────────────────

    #buildLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id        = 'dm-loading';
        overlay.className = 'dm-overlay dm-loading dm-hidden';

        const messageSpan = document.createElement('span');
        messageSpan.id = 'dm-loading-msg';

        overlay.appendChild(messageSpan);
        document.body.appendChild(overlay);

        this.#staticElements.loadingOverlay = overlay;
        this.#staticElements.loadingMessage = messageSpan;
    }

    /** @param {string} message */
    #showLoadingOverlay(message) {
        this.#staticElements.loadingMessage.textContent = message;
        this.#staticElements.loadingOverlay?.classList.remove('dm-hidden');
    }

    #hideLoadingOverlay() {
        this.#staticElements.loadingOverlay?.classList.add('dm-hidden');
    }

    // ── Toast ──────────────────────────────────────────────────────────────

    #buildToastElement() {
        const toast = document.createElement('div');
        toast.id        = 'dm-toast';
        toast.className = 'dm-toast dm-hidden';
        document.body.appendChild(toast);
        this.#staticElements.toastElement = toast;
    }

    /** @param {string} message */
    #showToast(message) {
        const toastElement = this.#staticElements.toastElement;
        if (!toastElement) return;

        toastElement.textContent = message;
        toastElement.classList.remove('dm-hidden');
        toastElement.classList.add('dm-toast--visible');

        clearTimeout(this.#toastTimer);
        this.#toastTimer = setTimeout(() => {
            toastElement.classList.remove('dm-toast--visible');
            setTimeout(() => toastElement.classList.add('dm-hidden'), 300);
        }, 2500);
    }
}
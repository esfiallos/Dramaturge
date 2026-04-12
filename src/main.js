// src/main.js
// Bootstrap de producción — instancia todos los módulos y arranca el juego.

import { db }                from './core/database/db.js';
import { seedProductionDB }  from './core/database/seed.js';
import { Dramaturge }        from './core/Engine.js';
import { KParser }           from './core/parser/Parser.js';
import { Renderer }          from './modules/Renderer.js';
import { AudioManager }      from './modules/Audio.js';
import { GameState }         from './core/State.js';
import { SaveManager }       from './core/SaveManager.js';
import { PuzzleSystem }      from './modules/PuzzleSystem.js';
import { SceneManager }      from './core/SceneManager.js';
import { MenuSystem }        from './modules/MenuSystem.js';

// ─── Instanciación de módulos ─────────────────────────────────────────────────

const renderer     = new Renderer();
const audio        = new AudioManager();
const parser       = new KParser();
const initialState = new GameState();
const saveManager  = new SaveManager(db);
const engine       = new Dramaturge(db, renderer, audio, initialState, saveManager);
const sceneManager = new SceneManager(engine, parser);
const puzzleSystem = new PuzzleSystem(db, initialState);

// ─── Inyección de callbacks externos ──────────────────────────────────────────
// El Engine no importa PuzzleSystem ni SceneManager directamente —
// los recibe como callbacks para evitar dependencias circulares.

engine.puzzleResolver = (puzzleId)           => puzzleSystem.open(puzzleId);
engine.sceneLoader    = (target, fadeColor)  => sceneManager.goto(target, fadeColor);

// ─── Menú principal ───────────────────────────────────────────────────────────

const menu = new MenuSystem({
    engine,
    saveManager,
    sceneManager,
    audio,
    startScene:   'cap01/scene_01',
    gameTitle:    'DRAMATURGE',
    gameSubtitle: 'Cada secreto tiene su precio',
});

// ─── InputGate ────────────────────────────────────────────────────────────────
//
// Punto de entrada único para todo input del jugador (clic y teclado).
//
// Garantías:
//   1. Solo pasa si el estado del menú es IN_GAME
//   2. No pasa si el backlog está abierto
//   3. No pasa si hay paneles del menú abiertos (slots, audio, modal)
//   4. Cooldown de 60ms — descarta dobles clicks y rebotes de teclado
//
// Engine.next() tiene su propio guard interno (#isAdvancing) para re-entrancia
// async, pero el InputGate es la primera línea de defensa.

const INPUT_COOLDOWN_MS = 60;
let lastInputTimestamp  = 0;

function inputGate() {
    if (menu.state !== 'IN_GAME') return;
    if (menu.backlogOpen) return;

    const panelIsOpen = document.querySelector(
        '#dm-slot-panel:not(.dm-hidden), #dm-audio-panel:not(.dm-hidden), #dm-modal:not(.dm-hidden)'
    );
    if (panelIsOpen) return;

    const now = Date.now();
    if (now - lastInputTimestamp < INPUT_COOLDOWN_MS) return;
    lastInputTimestamp = now;

    engine.next();
}

document.getElementById('click-zone')
    ?.addEventListener('click', (clickEvent) => {
        const clickedOnUiElement = clickEvent.target.closest(
            'button, a, input, #hud, #pause-menu, #main-menu, [id^="dm-"]'
        );
        if (clickedOnUiElement) return;
        inputGate();
    });

document.addEventListener('keydown', (keyboardEvent) => {
    if (keyboardEvent.code !== 'Space' && keyboardEvent.code !== 'Enter') return;

    const focusedTag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(focusedTag)) return;

    keyboardEvent.preventDefault();
    inputGate();
});

// ─── Service Worker ───────────────────────────────────────────────────────────
// Solo en producción — en desarrollo interferiría con el HMR de Vite.

if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(`${import.meta.env.BASE_URL}sw.js`)
            .then(registration => console.log('[SW] Registrado:', registration.scope))
            .catch(error      => console.warn('[SW] Error al registrar:', error));
    });
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

async function initializeGame() {
    await renderer.init();
    await seedProductionDB(db);
    await menu.init();
}

initializeGame();
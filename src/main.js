// src/main.js
// Bootstrap de PRODUCCIÓN.

import { db }             from './core/database/db.js';
import { seedProductionDB } from './core/database/seed.js';
import { Dramaturge }    from './core/Engine.js';
import { KParser }       from './core/parser/Parser.js';
import { Renderer }      from './modules/Renderer.js';
import { AudioManager }         from './modules/Audio.js';
import { GameState }     from './core/State.js';
import { SaveManager }   from './core/SaveManager.js';
import { PuzzleSystem }  from './modules/PuzzleSystem.js';
import { SceneManager }  from './core/SceneManager.js';
import { MenuSystem }    from './modules/MenuSystem.js';

const renderer    = new Renderer();
const audio       = new AudioManager();
const parser      = new KParser();
const state       = new GameState();
const saveManager = new SaveManager(db);
const engine      = new Dramaturge(db, renderer, audio, state, saveManager);
const sceneManager = new SceneManager(engine, parser);

// Resolvers inyectados — el Engine no importa estos módulos directamente
const puzzleSystem = new PuzzleSystem(db, state);
engine.puzzleResolver = (id)     => puzzleSystem.open(id);
engine.sceneLoader    = (target) => sceneManager.goto(target);

// Menú principal — orquesta el flujo completo
const menu = new MenuSystem({
    engine,
    saveManager,
    sceneManager,
    audio,
    startScene:   'cap01/scene_01',
    gameTitle:    'DRAMATURGE',     // ← cambiar por el título del juego
    gameSubtitle: 'Cada secreto tiene su precio',
});

// ── InputGate — punto de entrada único para todo input del jugador ──────────
//
// Garantías:
//   1. Solo pasa si el estado del menú es IN_GAME
//   2. No pasa si hay paneles del menú abiertos (slots, audio, modal)
//   3. Cooldown de 60ms — descarta dobles clicks/teclas del mismo gesto
//   4. No pasa si click fue sobre un elemento de UI (botón, hud, menú)
//
// Engine.next() tiene su propio guard interno (_nextRunning) para re-entrancia
// en llamadas async, pero este gate es la primera línea de defensa.

const S = MenuSystem.STATES ?? {};

let _lastInputTs = 0;

function inputGate(fromUI = false) {
    // Solo en IN_GAME
    if (menu.state !== 'IN_GAME') return;

    // No si hay panel abierto — incluido el backlog
    if (menu.backlogOpen) return;
    const panelOpen = document.querySelector(
        '#dm-slot-panel:not(.dm-hidden), #dm-audio-panel:not(.dm-hidden), #dm-modal:not(.dm-hidden)'
    );
    if (panelOpen) return;

    // Cooldown de 60ms (cubre doble-tap y bounce de teclado)
    const now = Date.now();
    if (now - _lastInputTs < 60) return;
    _lastInputTs = now;

    engine.next();
}

document.getElementById('click-zone')
    ?.addEventListener('click', (e) => {
        // Ignorar si el clic fue sobre un botón o elemento de UI
        if (e.target.closest('button, a, input, #hud, #pause-menu, #main-menu, [id^="dm-"]')) return;
        inputGate();
    });

document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
    e.preventDefault();
    inputGate();
});

async function init() {
    await renderer.init();
    await seedProductionDB(db); // no-op si la DB ya tiene datos
    await menu.init();
}

init();
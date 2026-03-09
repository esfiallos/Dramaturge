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

document.getElementById('click-zone')
    ?.addEventListener('click', (e) => {
        if (e.target.closest('button, #hud, #pause-menu, #main-menu')) return;
        engine.next();
    });

// ── Avance por teclado (Space) ────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    const mainMenu  = document.getElementById('main-menu');
    const pauseMenu = document.getElementById('pause-menu');
    if (!mainMenu?.classList.contains('hidden'))  return;
    if (pauseMenu?.classList.contains('visible')) return;
    e.preventDefault();
    engine.next();
});

async function init() {
    await renderer.init();
    await seedProductionDB(db); // no-op si la DB ya tiene datos
    await menu.init();
}

init();
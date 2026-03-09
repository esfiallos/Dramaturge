# Arquitectura de VEMN

---

## Diagrama de módulos

```
main.js
├── MERenderer        → PixiJS v8 (canvas) + DOM overlay
├── MEAudio           → 3 canales HTMLAudioElement
├── EParser           → Table-Driven, produce AST de instrucciones
├── GameState         → flags, inventory, audioSettings, playTime
├── SaveManager       → Dexie + JSON export/import
├── EmersEngine       ← núcleo, recibe todos los demás
│   ├── engine.puzzleResolver = PuzzleSystem.open()
│   └── engine.sceneLoader    = SceneManager.goto()
├── PuzzleSystem      → 3 tipos, Promise-based, DOM overlay
├── SceneManager      → fetch .ems + caché + loadOnly
└── MenuSystem        → splash, pausa, slots, audio
    ├── deps: engine, saveManager, sceneManager, audio
    └── preload: _cachedSaves en init()
```

---

## Flujo de ejecución normal

```
MenuSystem.init()
  └─ _preloadSaves()          ← consulta Dexie, llena _cachedSaves

[Usuario clic "Nueva Partida"]
  └─ MenuSystem._newGame()
       └─ SceneManager.start('cap01/scene_01')
            └─ _fetch('/scripts/cap01/scene_01.ems')
            └─ parser.parse(raw) → instrucciones[]
            └─ engine.loadScript(instrucciones)
            └─ engine.next()    ← comienza la cadena

[engine.next() en loop]
  └─ execute(inst)
       ├─ PAWN_LOAD     → db.characters.get() → new Character() → next()
       ├─ BG_CHANGE     → renderer.changeBackground() → next()
       ├─ AUDIO         → audio.playBGM/playSE() → next()
       ├─ SPRITE_SHOW   → renderer.renderSprite() → next()
       ├─ DIALOGUE      → renderer.typewriter() → isBlocked=true
       ├─ NARRATE       → renderer.typewriter(null,...) → isBlocked=true
       ├─ WAIT          → setTimeout → isBlocked=true → next()
       ├─ PUZZLE        → puzzleResolver(id) → typewriter(result) → isBlocked=true
       ├─ GOTO          → sceneManager.goto(target)  [reemplaza contexto]
       ├─ SET_FLAG      → state.setFlag() → next()
       ├─ INVENTORY_ADD → state.addItem() → next()
       └─ INVENTORY_REMOVE → state.removeItem() → next()

[Usuario clic en pantalla]
  └─ engine.next()
       ├─ si isBlocked → renderer.skipTypewriter() [completa texto, desbloquea]
       └─ si libre     → execute(siguiente instrucción)
```

---

## Regla de bloqueo del engine

| Instrucción | Bloquea | Se desbloquea con |
|---|---|---|
| `DIALOGUE` | ✅ | Clic del usuario |
| `NARRATE` | ✅ | Clic del usuario |
| `WAIT` | ✅ | Timeout automático |
| `PUZZLE` | ✅ | Resolución + clic |
| Todos los demás | ❌ | Encadenan `next()` automáticamente |

---

## Parser — Table-Driven pattern

`PARSE_RULES` en `Parser.js` es un array de `{ regex, type, transform? }`.  
`parse()` nunca se modifica — solo se añaden entradas al array.

Para añadir una nueva instrucción:
1. Definir el regex en `Grammar.js` con named groups `(?<nombre>)`
2. Añadir entrada en `PARSE_RULES` (respetando el orden — `INVENTORY_ADD/REMOVE` antes que `SET_FLAG`)
3. Añadir `case` en `Engine.js execute()`

---

## SaveManager — Estructura de un save

```js
{
    slotId:        'autosave',
    savedAt:       1234567890,     // Date.now()
    currentFile:   'cap01/scene_01.ems',
    currentIndex:  4,              // instrucción donde se guardó
    flags:         { puzzle_solved: true, capitulo: 2 },
    inventory:     ['llave_maestra'],
    audioSettings: { bgmVolume: 0.5, sfxVolume: 0.8, voiceVolume: 1.0 },
    playTime:      320             // segundos acumulados
}
```

---

## SceneManager — Flujo de goto vs continuar

```
goto cap01/scene_02
  └─ _loadAndRun()
       └─ loadScript() + next()     ← ejecuta desde el inicio

Continuar (desde autosave)
  └─ loadOnly()
       └─ loadScript()              ← instala sin ejecutar
  └─ engine.resumeFromState()       ← fija currentIndex
  └─ engine.next()                  ← ejecuta desde el índice guardado
```

La caché del SceneManager guarda instrucciones ya parseadas por target.  
Un `goto` a una escena ya visitada no hace fetch ni parse.

---

## MenuSystem — Estados posibles

```
MAIN_MENU
  ├─ _newGame()       → PLAYING
  ├─ _continueGame()  → PLAYING  (requiere autosave)
  └─ _openSlots('load') → SLOT_PANEL → PLAYING

PLAYING
  ├─ ESC / btn-pause  → PAUSE_MENU
  └─ btn-exit         → MAIN_MENU

PAUSE_MENU
  ├─ _openSlots('save')  → SLOT_PANEL → PAUSE_MENU
  ├─ _openSlots('load')  → SLOT_PANEL → PLAYING
  ├─ _openAudio()        → AUDIO_PANEL → PAUSE_MENU
  ├─ _export()           → descarga JSON
  ├─ _import()           → PLAYING
  └─ _exitToMenu()       → MAIN_MENU
```

---

## Dexie — Schema v2

```js
db.version(2).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    inventory:  'itemKey',
    saves:      'slotId, savedAt',
});
```

---

## Capas z-index

| z-index | Elemento |
|---|---|
| 1 | PixiJS canvas (bg layer) |
| 10 | PixiJS canvas (sprite layer) |
| 30 | `#click-zone` (textbox + avance) |
| 40 | `#puzzle-overlay` |
| 50 | `#hud` |
| 60 | `#pause-menu` |
| 61 | `#audio-panel` |
| 62 | `#slot-panel` |
| 100 | `#main-menu` |
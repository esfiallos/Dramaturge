# Arquitectura de Dramaturge

---

## Diagrama de módulos

```
main.js
├── Renderer       → PixiJS v8 (canvas) + DOM overlay
├── AudioManager   → 3 canales HTMLAudioElement + ducking
├── Parser         → Table-Driven, produce array de instrucciones
├── State          → flags, inventory, audioSettings, highWaterMark
├── SaveManager    → Dexie v4 + JSON export/import
├── Dramaturge     ← núcleo del motor, recibe todos los demás
│   ├── engine.puzzleSystem  = PuzzleSystem
│   └── engine.sceneManager  = SceneManager
├── PuzzleSystem   → 3 tipos, Promise-based, DOM overlay
├── SceneManager   → fetch .dan + caché de instrucciones parseadas
└── MenuSystem     → menú principal · pausa · slots · backlog · galería
    ├── deps: engine, saveManager, sceneManager, audio
    └── preload: _cachedSaves en init()
```

---

## Flujo de ejecución normal

```
MenuSystem.init()
  └─ _preloadSaves()            ← consulta Dexie, llena _cachedSaves

[Usuario clic "Nueva Partida"]
  └─ engine.reset()             ← limpia state, activePawns, backlog
  └─ SceneManager.start('cap01/scene_01')
       └─ fetch('/scripts/cap01/scene_01.dan')
       └─ parser.parse(raw) → instrucciones[]
       └─ engine.loadScript(instrucciones)
       └─ engine.next()         ← comienza la cadena

[engine.next() — InputGate → re-entrancy guard → _nextInternal()]
  └─ execute(inst)
       ├─ PAWN_LOAD        → db.characters.get() → activePawns.set() → _nextInternal()
       ├─ BG_CHANGE        → renderer.changeBackground() → _nextInternal()
       ├─ AUDIO            → audio.playBGM/playSE() → _nextInternal()
       ├─ SPRITE_SHOW      → renderer.renderSprite() → _nextInternal()
       ├─ SPRITE_HIDE      → renderer.hideSprite() → _nextInternal()
       ├─ DIALOGUE         → backlog.push() → renderer.typewriter() → bloqueado
       ├─ NARRATE          → backlog.push() → renderer.typewriter(null) → bloqueado
       ├─ WAIT             → setTimeout → _nextInternal()  [omitido en skipMode]
       ├─ PUZZLE           → puzzleSystem.open(id) → typewriter(result) → bloqueado
       ├─ GOTO             → sceneManager.goto(target)  [reemplaza contexto]
       ├─ SET_FLAG         → state.setFlag() → _nextInternal()
       ├─ INVENTORY_ADD    → state.addItem() → _nextInternal()
       ├─ INVENTORY_REMOVE → state.removeItem() → _nextInternal()
       ├─ UNLOCK           → db.gallery.put() → _nextInternal()
       ├─ COND_JUMP        → evalúa condición → ajusta currentIndex → _nextInternal()
       └─ JUMP             → ajusta currentIndex → _nextInternal()

[Usuario clic en pantalla / Space / Enter — pasa por InputGate]
  └─ engine.next()
       ├─ si typewriter activo → renderer.completeText() [instantáneo]
       └─ si libre → execute(instrucción siguiente)
```

---

## Regla de bloqueo del engine

| Instrucción | Bloquea | Se desbloquea con |
|---|---|---|
| `DIALOGUE` | ✅ | Clic del usuario |
| `NARRATE` | ✅ | Clic del usuario |
| `WAIT` | ✅ | Timeout automático (omitido en skip) |
| `PUZZLE` | ✅ | Resolución + clic |
| Todos los demás | ❌ | Encadenan `_nextInternal()` automáticamente |

---

## Re-entrancy guard

`next()` público tiene un guard `_nextRunning` que descarta llamadas mientras el engine está ejecutando. Esto previene que el InputGate procese dos clics rápidos y doble el avance.

Las llamadas internas siempre usan `_nextInternal()` para saltarse el guard — el engine puede llamarse a sí mismo en cadena sin riesgo porque es single-threaded.

El InputGate en `main.js` añade un cooldown de 60ms adicional para el anti-bounce en clicks rápidos.

---

## Parser — Table-Driven pattern

`PARSE_RULES` en `Parser.js` es un array de `{ regex, type }`.  
`parse()` nunca se modifica — solo se añaden entradas al array.

El parser hace dos pases:
1. **Match** — recorre las líneas y aplica `PARSE_RULES` en orden, produciendo un array plano de instrucciones tipadas
2. **resolveBlocks** — recorre el array y convierte `IF/ELSE/ENDIF` en instrucciones de salto `COND_JUMP` y `JUMP` con índices absolutos

Para añadir una instrucción nueva al lenguaje siempre son tres archivos:

```
Grammar.js   ← definir el regex con named groups (?<nombre>)
Parser.js    ← añadir { regex: KDN_GRAMMAR.NUEVA, type: 'NUEVA' } en PARSE_RULES
Engine.js    ← añadir case 'NUEVA': en execute()
```

El orden en `PARSE_RULES` importa. Las reglas más específicas van antes que las generales. `INVENTORY_ADD` y `INVENTORY_REMOVE` van antes que `SET_FLAG` porque ambas empiezan con `set`.

---

## SaveManager — Estructura de un save

```js
{
    slotId:        'autosave',         // 'slot_1' | 'slot_2' | 'slot_3' | 'autosave'
    savedAt:       1234567890,         // Date.now()
    currentFile:   'cap01/scene_01',   // sin extensión
    currentIndex:  4,
    highWaterMark: 12,                 // índice más alto completado — controla skip
    flags:         { conoce_aldric: true, cap02_completo: false },
    inventory:     ['llave_maestra'],
    visualState: {
        bg:      'forest',
        sprites: { center: { actorId: 'valeria', path: '...' } },
        mode:    'dialogue'            // 'dialogue' | 'narrate'
    },
    audioSettings: { bgm: 0.5, se: 0.8, voice: 1.0 },
}
```

`visualState` se usa para restaurar la escena visualmente al cargar — el fondo y los sprites activos se recrean antes de que el jugador tenga el control.

---

## SceneManager — goto vs continuar

```
goto cap01/scene_02
  └─ _loadAndRun(target)
       └─ loadScript(instrucciones) + next()    ← ejecuta desde el inicio

Continuar desde save
  └─ loadScript(instrucciones)                  ← instala sin ejecutar
  └─ engine.resumeFromState(save)               ← fija currentIndex + highWaterMark
  └─ engine.next()                              ← ejecuta desde el índice guardado
```

La caché del SceneManager guarda instrucciones ya parseadas por target. Un `goto` a una escena ya visitada no hace fetch ni parse.

---

## MenuSystem — State machine

```
MAIN_MENU
  ├─ Nueva Partida   → engine.reset() → SceneManager.start() → IN_GAME
  ├─ Continuar       → SceneManager.continue(autosave) → IN_GAME
  ├─ Cargar          → SLOT_PANEL(load) → IN_GAME
  └─ Galería         → GALLERY_PANEL → MAIN_MENU

IN_GAME
  ├─ ESC / btn-pause → engine.stopModes() → audio.pauseDuck() → PAUSED
  ├─ btn-save        → SLOT_PANEL(save) → IN_GAME
  ├─ btn-auto        → toggle autoMode
  ├─ btn-skip        → triggerSkip() → para en highWaterMark
  ├─ btn-backlog     → BACKLOG_PANEL → IN_GAME
  └─ btn-exit        → engine.stopModes() → MAIN_MENU

PAUSED
  ├─ Continuar       → audio.pauseUnduck() → IN_GAME
  ├─ Guardar         → SLOT_PANEL(save) → PAUSED
  ├─ Cargar          → SLOT_PANEL(load) → IN_GAME
  ├─ Ajustes audio   → AUDIO_PANEL → PAUSED
  ├─ Export/Import   → descarga/carga JSON
  └─ Menú principal  → MAIN_MENU
```

---

## Capas z-index

| z-index | Elemento | Descripción |
|---|---|---|
| 5 | PixiJS canvas | bg layer + sprite layer |
| 30 | `#click-zone` | Textbox + área de avance |
| 40 | `#puzzle-overlay` | UI de puzzles |
| 50 | `#hud` | Botones en juego |
| 60 | `#pause-menu` | Menú de pausa |
| 61 | `#audio-panel` | Panel de volúmenes |
| 62 | `#slot-panel` | Panel de slots |
| 100 | `#main-menu` | Menú principal / splash |
| 150 | `.dm-backlog` | Historial de diálogos |
| 200 | `#dm-gallery` | Panel de galería |
| 210 | `.dm-gallery__lightbox` | Lightbox de CG |
| 999 | `#rotate-hint` | Indicador de rotación (portrait táctil) |

---

## DramaturgeDB — Schema Dexie v3

```js
db.version(1).stores({ characters: 'id, name', puzzles: 'puzzleId, type', inventory: 'itemKey' });
db.version(2).stores({ ...v1, saves: 'slotId, savedAt' });
db.version(3).stores({ ...v2, gallery: 'id, unlockedAt' });
```

Regla: nunca modificar una versión ya publicada. Siempre añadir `version(N+1)`.

Los índices declarados en el schema son solo los campos usados en `.where()` o `.get()`. Todos los demás campos del objeto se guardan automáticamente aunque no estén declarados.
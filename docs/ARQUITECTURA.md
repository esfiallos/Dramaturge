# Arquitectura de Dramaturge

---

## Diagrama de módulos

```
main.js
├── Renderer          → PixiJS v8 (canvas) + DOM overlays + WAAPI
├── AudioManager      → 3 canales Howler.js + ducking
├── Parser            → Table-Driven, produce array de instrucciones
├── State             → flags, inventory, audioSettings, highWaterMark
├── SaveManager       → Dexie v4 encapsulado + JSON export/import
├── Dramaturge        ← Engine — gestiona CUÁNDO avanzar
│   ├── engine.#executor      = InstructionExecutor
│   ├── engine.puzzleResolver = callback → PuzzleSystem
│   └── engine.sceneLoader    = callback → SceneManager
├── InstructionExecutor → gestiona CÓMO ejecutar cada instrucción
│   └── usa ConditionEvaluator para evaluar if/else
├── ConditionEvaluator  → clase estática, pura, sin estado
├── PuzzleSystem      → 3 tipos, Promise-based, DOM overlay
├── SceneManager      → fetch .dan + caché de instrucciones parseadas
└── MenuSystem        → menú principal · pausa · slots · backlog · galería
    ├── deps: engine, saveManager, sceneManager, audio
    └── paneles: SlotPanel, AudioPanel, BacklogPanel, GalleryPanel, ModalPanel
```

---

## Separación de responsabilidades — Engine vs InstructionExecutor

Esta es la decisión arquitectónica central. Antes todo vivía en Engine;
ahora hay dos clases con responsabilidades distintas:

```
Engine (Dramaturge)
  — Sabe CUÁNDO avanzar
  — Gestiona: currentIndex, highWaterMark, autoMode, skipMode
  — Gestiona: autosave, modos de lectura, re-entrancy guard
  — Expone: API pública (next, reset, loadScript, toggleAutoMode…)
  — NO sabe cómo ejecutar una instrucción individual

InstructionExecutor
  — Sabe CÓMO ejecutar cada instrucción
  — Gestiona: personajes cargados, slots ocupados, backlog
  — Contiene: el handler map con una entrada por instrucción
  — NO sabe cuándo avanzar — solo llama hooks.advance() o hooks.jumpTo()
```

La comunicación entre ambos es exclusivamente a través de `EngineHooks`:

```js
// Engine construye este objeto y lo pasa al executor en el constructor
{
    getState:          () => this.#state,
    getSkipMode:       () => this.skipMode,
    getPuzzleResolver: () => this.puzzleResolver,
    getSceneLoader:    () => this.sceneLoader,
    advance:           () => this.#advance(),      // ejecutar instrucción siguiente
    jumpTo:            (i) => this.#jumpTo(i),     // saltar a índice i y continuar
    setBlocked:        (b) => { this.isBlocked = b; },
    onTextComplete:    () => this.#onTextLineComplete(),
}
```

Si hace falta un nuevo punto de comunicación entre ambos módulos,
se añade al objeto EngineHooks explícitamente. Nada más cambia.

---

## Flujo de ejecución normal

```
MenuSystem.init()
  └─ carga slots desde Dexie en paralelo

[Usuario clic "Nueva Partida"]
  └─ engine.reset()             ← limpia state, executor, backlog
  └─ SceneManager.start('cap01/scene_01')
       └─ fetch('/scripts/cap01/scene_01.dan')
       └─ parser.parse(raw) → instrucciones[]
       └─ engine.loadScript(instrucciones)
       └─ engine.next()

[engine.next() — InputGate → re-entrancy guard → #advance()]
  └─ instruction = instructions[currentIndex++]
  └─ renderer.activateInstantMode() si skip activo y texto ya visto
  └─ executor.dispatch(instruction)
       └─ #handlers.get(instruction.type)(instruction)
            ├─ instrucción no-bloqueante → hooks.advance()   ← encadena
            ├─ instrucción bloqueante    → hooks.setBlocked(true) → espera
            └─ salto condicional         → hooks.jumpTo(index)

[hooks.advance() o hooks.jumpTo()]
  └─ engine.#advance() — ciclo vuelve al inicio

[Texto termina — hooks.onTextComplete()]
  └─ engine.#onTextLineComplete()
       └─ actualiza highWaterMark
       └─ programa autosave (debounce 2500ms)
       └─ si autoMode → programa siguiente avance
       └─ si skipMode → avanza o para en highWaterMark
```

---

## Regla de bloqueo del engine

| Instrucción | Bloquea | Se desbloquea con |
|---|---|---|
| `DIALOGUE` | ✅ | Clic del usuario |
| `NARRATE` | ✅ | Clic del usuario |
| `WAIT` | ✅ | Timeout automático (omitido en skip) |
| `PUZZLE` | ✅ | Resolución + clic |
| `FX_SHAKE` | ✅ | Ticker — fin de animación |
| `FX_FLASH` | ✅ | WAAPI — fin de animación |
| `FX_VIGNETTE` | ❌ | No bloquea |
| Todos los demás | ❌ | hooks.advance() automático |

---

## Re-entrancy guard

`next()` público tiene un guard `#isAdvancing` que descarta llamadas
mientras el engine está procesando. Esto previene que dos clics rápidos
dupliquen el avance.

Los métodos internos siempre usan `#advance()` o `hooks.advance()`,
nunca `next()` — esto es válido tanto para Engine como para InstructionExecutor.

El InputGate en `main.js` añade un cooldown de 60ms adicional.

---

## InstructionExecutor — Handler Map

`#buildHandlerMap()` devuelve un `Map<string, handler>` construido en el
constructor. Cada tipo de instrucción tiene exactamente un handler.

```js
// Leer el mapa = saber todas las instrucciones que existen
#buildHandlerMap() {
    return new Map([
        ['PAWN_LOAD',        (i) => this.#handlePawnLoad(i)],
        ['SPRITE_SHOW',      (i) => this.#handleSpriteShow(i)],
        // … una línea por instrucción …
        ['UNLOCK',           (i) => this.#handleUnlock(i)],
    ]);
}
```

Todos los handlers terminan con una de dos llamadas — sin excepciones:
- `hooks.advance()` — ejecutar la instrucción siguiente
- `hooks.jumpTo(index)` — saltar a un índice y continuar

Si un handler no llama ninguna, el engine se cuelga silenciosamente.
Este es el único bug posible al añadir una instrucción nueva.

---

## ConditionEvaluator — clase estática pura

Evalúa condiciones del lenguaje Koedan sin estado propio:

```js
ConditionEvaluator.evaluate(condition, state) → boolean
```

No instancia nada. Recibe el estado como argumento. Completamente
testeable sin dependencias. Para añadir un operador nuevo: un `case`
en `#applyOperator()`, nada más.

---

## Parser — Table-Driven pattern

`PARSE_RULES` en `Parser.js` es un array de `{ regex, type }`.
`parse()` nunca se modifica — solo se añaden entradas al array.

El parser hace dos pases:
1. **Match** — recorre líneas y aplica `PARSE_RULES`, produciendo instrucciones tipadas
2. **resolveBlocks** — convierte `IF/ELSE/ENDIF` en `COND_JUMP` y `JUMP` con índices absolutos

Para añadir una instrucción nueva al lenguaje siempre son exactamente tres archivos:

```
Grammar.js            ← regex con named groups (?<nombre>)
Parser.js             ← { regex: KDN_GRAMMAR.NUEVA, type: 'NUEVA' }
InstructionExecutor.js ← entrada en #buildHandlerMap() + método #handleNueva()
```

El orden en `PARSE_RULES` importa. `INVENTORY_ADD` y `INVENTORY_REMOVE`
van antes que `SET_FLAG` porque ambas empiezan con `set`.

---

## SaveManager — encapsulamiento de Dexie

SaveManager es la única clase que sabe que existe Dexie e IndexedDB.
Ningún módulo externo accede a `db` directamente.

```js
// API pública — nombres de dominio, no de tabla
saveManager.save(state, slotId)
saveManager.load(slotId)
saveManager.deleteSlot(slotId)
saveManager.listUnlockedCGs()   // ← encapsula db.gallery
saveManager.exportToFile(state)
saveManager.importFromFile()
```

Si la persistencia migra de IndexedDB a otra solución, solo cambia
SaveManager. El resto del proyecto no se entera.

---

## Renderer — Sistema de animaciones

**Regla de tres casos, sin excepciones:**

```
¿Objeto PixiJS? (sprite, fondo, stage, Container)
  → app.ticker.add(tick)

¿Elemento DOM con transición de opacidad/posición?
  → element.animate([keyframes], options).finished   [WAAPI]

¿Texto carácter a carácter?
  → requestAnimationFrame
```

Esta regla define dónde va cada efecto nuevo. No hay un cuarto caso.

**Curvas de easing centralizadas** — objeto `EASING` al inicio del archivo:

```js
const EASING = Object.freeze({
    linear:    'linear',
    easeIn:    'cubic-bezier(0.4, 0, 1, 1)',
    easeOut:   'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    snap:      'cubic-bezier(0.4, 0, 0.6, 1)',
});
```

Cambiar una curva aquí afecta a todos los efectos que la usan de forma
coherente. La función `applyEase(t, nombre)` proporciona los equivalentes
matemáticos para animaciones Ticker.

**Overlays DOM** — todos creados en `init()`, nunca en el primer uso:

```
#advanceIndicator   → indicador ▼ en el textbox
#flashOverlay       → reutilizado en cada fxFlash()
#vignetteOverlay    → reutilizado en cada fxVignette()
```

**API pública hacia Engine** — tres métodos que formalizan el contrato:

```js
renderer.activateInstantMode()   // Engine llama antes de texto en skip
renderer.isSkipLocked            // Engine consulta para proteger avance
renderer.applyNarrationMode(on)  // Engine llama al restaurar desde save
```

---

## SaveManager — Estructura de un save

```js
{
    slotId:        'autosave',
    savedAt:       1234567890,
    currentFile:   'cap01/scene_01',     // sin extensión .dan
    currentIndex:  4,
    highWaterMark: 12,                   // controla hasta dónde llega el skip
    flags:         { conoce_aldric: true },
    inventory:     ['llave_maestra'],
    visualState: {
        bg:      'forest',
        sprites: { center: { actorId: 'valeria', path: '...' } },
        mode:    'dialogue',
        bgm:     { track: 'track_01', vol: 0.4 },
    },
    audioSettings: { bgmVolume: 0.5, sfxVolume: 0.8, voiceVolume: 1.0 },
    playTime:      180,                  // segundos acumulados
}
```

---

## SceneManager — goto vs continuar

```
goto cap01/scene_02
  └─ SceneManager.goto(target, fadeColor)
       └─ si fadeColor → transición DOM antes de cargar
       └─ fetchAndParseIfNeeded(target)   ← caché de instrucciones
       └─ engine.loadScript() + engine.next()

Continuar desde save
  └─ SceneManager.loadOnly(target)        ← instala sin ejecutar
  └─ engine.resumeFromState(savedState)   ← fija índice + visual
  └─ engine.next()                        ← ejecuta desde el índice
```

---

## MenuSystem — State machine

```
MAIN_MENU
  ├─ Nueva Partida   → engine.reset() → SceneManager.start() → IN_GAME
  ├─ Cargar          → SlotPanel(load) → IN_GAME
  └─ Galería         → GalleryPanel → MAIN_MENU

IN_GAME
  ├─ ESC / btn-pause → engine.stopAllReadingModes() → PAUSED
  ├─ btn-save        → SlotPanel(save) → IN_GAME
  ├─ btn-auto        → engine.toggleAutoMode()
  ├─ btn-skip        → engine.triggerSkipMode() → para en highWaterMark
  ├─ btn-backlog     → BacklogPanel → IN_GAME
  └─ btn-exit        → autosave → MAIN_MENU

PAUSED
  ├─ Continuar       → audio.pauseUnduck() → IN_GAME
  ├─ Guardar         → SlotPanel(save) → PAUSED
  ├─ Cargar          → SlotPanel(load) → IN_GAME
  ├─ Audio           → AudioPanel → PAUSED
  └─ Menú principal  → ModalPanel confirmación → MAIN_MENU
```

Los paneles (`SlotPanel`, `AudioPanel`, `BacklogPanel`, `GalleryPanel`,
`ModalPanel`) son autónomos: tienen `open()`, `hide()` y `get isOpen()`.
`MenuSystem` los orquesta sin query al DOM.

Cambios de volumen van a través de `engine.updateAudioVolume(channel, vol)`,
no por mutación directa de `state.audioSettings`.

---

## Configuración de slots

`src/config/slots.js` es la fuente única de verdad para los IDs y
nombres de los slots de guardado. `SlotPanel` y `MenuSystem` importan
`SLOT_CONFIG` desde ahí. Añadir un slot nuevo es una sola edición.

---

## Capas z-index

| z-index | Elemento | Descripción |
|---|---|---|
| 5 | PixiJS canvas | bg layer + sprite layer |
| 15 | `#fx-vignette-overlay` | Viñeta de bordes |
| 20 | `#fx-flash-overlay` | Flash de color |
| 25 | `#scene-transition` | Fundido entre escenas |
| 30 | `#click-zone` | Textbox + área de avance |
| 40 | `#puzzle-overlay` | UI de puzzles |
| 50 | `#hud` | Botones en juego |
| 60 | `#pause-menu` | Menú de pausa |
| 100 | `#main-menu` | Menú principal / splash |
| 150 | `.dm-backlog` | Historial de diálogos |
| 200 | `#dm-gallery` | Panel de galería |
| 210 | `.dm-gallery__lightbox` | Lightbox de CG |

---

## DramaturgeDB — Schema Dexie v3

```js
db.version(1).stores({ characters: 'id, name', puzzles: 'puzzleId, type', inventory: 'itemKey' });
db.version(2).stores({ ...v1, saves: 'slotId, savedAt' });
db.version(3).stores({ ...v2, gallery: 'id, unlockedAt' });
```

Regla: nunca modificar una versión ya publicada. Siempre añadir `version(N+1)`.

Solo se declaran como índices los campos usados en `.where()` o `.get()`.
El resto se guarda automáticamente sin declararlos.
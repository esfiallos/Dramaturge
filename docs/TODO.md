# TODO — Dramaturge

Hoja de ruta activa del proyecto.

---

## ✅ Completado — v0.0.5

- [x] Parser Table-Driven con Grammar de regex nombrados
- [x] Engine con despachador central (`Dramaturge`) y re-entrancy guard
- [x] Renderer PixiJS v8 — sprites, fondos, fade, slide, typewriter
- [x] Audio con 3 canales (bgm · voice · se) + ducking de voz y pausa
- [x] GameState + SaveManager — Dexie v4 + export/import JSON
- [x] PuzzleSystem — MULTIPLE_CHOICE · FREE_TEXT · INVENTORY
- [x] SceneManager — fetch `.dan` + caché de instrucciones
- [x] MenuSystem — splash · pausa · slots · audio · state machine
- [x] Herramientas dev — editor · characters · canvas · debug
- [x] Sistema de diseño completo (Cinzel · Crimson Pro · tokens CSS)
- [x] HUD en juego — guardar · pausa · salir · auto · skip · backlog
- [x] Sistema de condiciones — `if / else / endif` + `inventory.has`
- [x] Operadores de comparación — `== != > < >= <=`
- [x] seed.js — bootstrap de instalación fresca
- [x] Modo automático — avance sin clic a velocidad configurable
- [x] Modo skip — salta hasta highWaterMark, para solo, cancelable
- [x] Backlog — historial de diálogos (tecla `L`, máx 80 entradas)
- [x] Audio ducking — BGM baja al 35% cuando habla una voz
- [x] Audio ducking de pausa — BGM baja al 20% al abrir menú
- [x] InputGate centralizado — re-entrancy guard + cooldown anti-bounce
- [x] `reset()` — limpia estado para nueva partida, preserva audioSettings
- [x] `unlock cg_id` — galería de CGs como meta-progreso en `db.gallery`
- [x] Galería — grid + lightbox + navegación teclado desde el menú
- [x] Letterbox 16:9 — el juego mantiene ratio en cualquier pantalla
- [x] Responsive táctil — HUD y botones con touch targets adecuados
- [x] Indicador "gira tu dispositivo" en portrait táctil
- [x] PWA — `manifest.json` con `orientation: landscape`
- [x] Derivación automática de basePath/voicePrefix en el panel de personajes
- [x] Export seed.js desde `/dev/characters.html`

---

## ✅ Completado — v0.0.6

- [x] `fx shake` — Renderer con PixiJS Ticker
- [x] `fx flash` — overlay DOM con WAAPI
- [x] `fx vignette` — overlay DOM con WAAPI
- [x] `goto escena fade:black` / `fade:white` — SceneManager con transición DOM
- [x] Service Worker básico + iconos PWA (`public/sw.js` + `manifest.json`)

---

## ✅ Completado — v0.0.7 (refactor de arquitectura)

- [x] `InstructionExecutor` extraído de Engine — handler map, responsabilidad única
- [x] `ConditionEvaluator` — clase estática pura, testeable sin dependencias
- [x] `EngineHooks` — contrato explícito entre Engine e InstructionExecutor
- [x] `engine.state` privado — escritura solo a través de métodos de Engine
- [x] `engine.updateAudioVolume()` — punto único de escritura de volúmenes
- [x] `engine.sessionElapsedMs` — getter público, corrige bug HUD de tiempo
- [x] `SaveManager.#db` privado — Dexie completamente encapsulada
- [x] `SaveManager.listUnlockedCGs()` — elimina violación Law of Demeter
- [x] `SLOT_CONFIG` en `src/config/slots.js` — fuente única de verdad de slots
- [x] `SlotPanel`, `AudioPanel`, `GalleryPanel` — `get isOpen()` en los tres
- [x] `MenuSystem.#bindClick()` — helper único para binding de eventos
- [x] `MenuSystem.#handleEscapeKey()` — usa `isOpen` de paneles, sin DOM queries
- [x] Renderer — todos los campos `_` migrados a `#`
- [x] Renderer — API pública formal (`activateInstantMode`, `isSkipLocked`, `applyNarrationMode`)
- [x] Renderer — sistema de animaciones con regla de 3 casos (Ticker / WAAPI / rAF)
- [x] Renderer — `EASING` centralizado, `applyEase()` para Ticker
- [x] Renderer — overlays creados en `init()`, sin creación lazy
- [x] Tests — Vitest con cobertura de `GameState`, `ConditionEvaluator`, `Parser`, `InstructionExecutor`

---

## 🔴 Prioridad alta

### Test de integración

Un test que cargue un script `.dan` real y verifique el comportamiento
end-to-end de Engine + InstructionExecutor + Parser juntos. Debería cubrir:
- Secuencia lineal con diálogo y narración
- Condicionales anidados con flags e inventario
- Puzzles (PASS y FAIL)
- Goto entre escenas

Requiere mockear SceneManager (el fetch de `.dan`) y el Renderer.

### Touch events completos

- Tap en `#click-zone` para avanzar (actualmente solo click)
- Swipe izquierda para abrir backlog
- Swipe derecha para cerrar backlog

El `InputGate` en `main.js` ya tiene la lógica de cooldown lista —
solo falta añadir los listeners de touch.

---

## 🟡 Prioridad media

### Rollback real

Deshacer un paso de diálogo. El `BacklogPanel` solo muestra el historial,
no vuelve el estado del juego. Requiere guardar snapshots de `GameState`
en un array paralelo al avance en Engine.

Diferente al backlog — el rollback necesita restaurar flags, inventario
y posición de sprites al punto anterior, no solo mostrar el texto.

### Galería con categorías y slots locked

- Mostrar slots `?` para CGs no vistos — requiere registrar todos los CGs
  posibles en la DB, no solo los desbloqueados
- Categorías opcionales: `unlock cg_01 category:"Capítulo 1"`

### Música adaptativa — crossfade entre tracks

Requiere migrar BGM a Web Audio API para crossfade suave entre tracks.
Howler tiene soporte parcial pero el control fino necesita la API nativa.

---

## 🟢 Prioridad baja / futuro

- **i18n** — textos del motor en múltiples idiomas
- **Modo accesibilidad** — solo texto, sin imágenes, fuente legible
- **TypeScript** — migración gradual empezando por los modelos de datos
- **Modos de pantalla adicionales** — soporte para portrait en tablets

---

## 📝 Deuda técnica activa

- **`_cachedSaves` en MenuSystem** no se invalida entre tabs.
  Irrelevante en uso normal — el juego no está diseñado para múltiples tabs.

- **`SPRITE_SHOW/HIDE`** no esperan a que la animación termine antes de
  `hooks.advance()`. Funciona en práctica pero puede causar solapamiento
  visual en secuencias muy rápidas de show/hide sin pausa.

- **`resolveAudioPath`** usa `fetch HEAD` para detectar formato disponible.
  Con Service Worker puede dar falsos negativos. Solución: guardar el
  formato en la DB junto al asset.

---

## 🎯 Próximo milestone — v0.0.8

Aun no se propone
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
- [x] seed.js — bootstrap de instalación fresca, generado desde `/dev/characters.html`
- [x] Modo automático — avance sin clic a velocidad configurable
- [x] Modo skip — salta hasta highWaterMark, para solo, cancelable
- [x] Backlog — historial de diálogos estilo Umineko (tecla `L`, máx 80 entradas)
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
- [x] Poses dinámicas (filas alias→archivo) en el panel de personajes
- [x] Export seed.js desde `/dev/characters.html`

---

## 🔴 Prioridad alta

### Efectos de pantalla

```dan
fx shake 0.4s
fx flash white 0.3s
fx vignette on
fx vignette off
```

Requiere: token `FX` en Grammar + Parser, nuevo método en Renderer usando el PixiJS Ticker para shake (offset de posición) y un overlay DOM para flash/viñeta.

### Transición de escena con color

```dan
goto cap02/scene_01 fade:black
goto cap02/scene_01 fade:white
```

La sintaxis de `fade:color` ya es natural en el lenguaje. Requiere actualizar el regex de GOTO en Grammar y que SceneManager espere el fundido antes de cargar la escena nueva.

---

## 🟡 Prioridad media

### Service Worker — modo offline e instalación PWA

Sin SW el juego no es instalable y no funciona sin conexión. Un SW básico de cache-first para los assets de `/public/` 
Candidato: `vite-plugin-pwa`.

Requiere también crear `public/assets/icons/icon-192.png` y `icon-512.png`.

### Galería con categorías y estado locked

La galería actual muestra solo los CGs desbloqueados. Mejoras pendientes:
- Mostrar slots vacíos (`?`) para CGs aún no vistos — requiere registrar todos los CGs posibles en la DB, no solo los desbloqueados
- Categorías opcionales — `unlock cg_01 category:"Capítulo 1"`

### Touch events completos

- Tap en `#click-zone` para avanzar (actualmente solo click)
- Swipe izquierda para abrir backlog
- Swipe derecha para cerrar backlog

### Rollback real

Deshacer un paso de diálogo — distinto del backlog. El backlog solo muestra, el rollback vuelve el estado del juego al punto anterior. Requiere guardar snapshots de `state` en un array paralelo al avance.

---

## 🟢 Prioridad baja / futuro

- **i18n** — textos del motor en múltiples idiomas, carpeta de scripts `.dan` por idioma
- **Modo accesibilidad** — solo texto, sin imágenes, fuente legible
- **Música adaptativa** — requiere migrar BGM a Web Audio API para crossfade entre tracks
- **TypeScript** — migración gradual, empezando por los modelos de datos

---

## 📝 Deuda técnica activa

- **`resolveAudioPath`** usa `fetch HEAD` para detectar formato disponible. Con Service Worker puede dar falsos negativos. Solución: guardar el formato en la DB junto al asset.
- **`_cachedSaves`** en MenuSystem no se invalida entre tabs. Irrelevante en uso normal.
- **`SPRITE_SHOW/HIDE`** no esperan a que la animación termine antes de `_nextInternal()`. Funciona en práctica pero puede causar solapamiento visual en secuencias muy rápidas.

---

## 🎯 Próximo milestone — v0.0.6

1. `fx shake` y `fx flash` en Renderer
2. `goto escena fade:black` en SceneManager
3. Service Worker básico + iconos PWA
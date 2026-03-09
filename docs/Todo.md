# TODO — VEMN

Hoja de ruta del proyecto. Ordenado por prioridad de implementación.

---

## ✅ Completado

- [x] Parser Table-Driven con Grammar de regex nombrados
- [x] Engine con despachador central y regla de bloqueo
- [x] Renderer PixiJS v8 (sprites, fondos, fade, slide)
- [x] Audio con 3 canales (bgm, voice, se) + multi-formato (mp3/ogg, webp/png/jpg)
- [x] GameState + SaveManager (Dexie + export/import JSON)
- [x] PuzzleSystem (MULTIPLE_CHOICE, FREE_TEXT, INVENTORY)
- [x] SceneManager (fetch .ems, caché, loadOnly para continuar)
- [x] MenuSystem (splash, pausa, slots, precarga de saves)
- [x] Laboratorio de desarrollo (`/dev/`)
- [x] Sistema de diseño completo (Cinzel + Crimson Pro, tokens CSS)
- [x] HUD en juego (guardar, pausa, salir)

---

## 🔴 Prioridad alta

### Sistema de condiciones en el script

Sin esto el árbol narrativo es completamente lineal.

```ems
# Sintaxis propuesta
if flag.puzzle_solved == true
    goto cap01/scene_02_pass
else
    goto cap01/scene_02_fail
endif

if inventory.has llave_maestra
    goto sala_secreta
endif
```

Requiere:
- Nuevos tokens en Grammar: `IF`, `ELSE`, `ENDIF`
- Lógica de bloque en Parser
- Evaluador de condiciones en Engine

### Seed de producción de la DB

Los personajes y puzzles se insertan desde el lab.  
Necesitamos un script que corra en producción la primera vez:

```
src/core/database/seed.js   ← se llama si db.characters.count() === 0
```

---

## 🟡 Prioridad media

### Transición entre escenas

```ems
goto cap02/scene_01 fade:black
goto cap02/scene_01 fade:white
```

### Efectos de pantalla

```ems
fx shake 0.5s
fx flash white 0.3s
fx vignette on
```

### Modo automático

Avanza sin clic a velocidad configurable. Botón en HUD.

### Historial de diálogos (backlog)

Últimas N líneas. Tecla `H` o botón en HUD.

---

## 🟢 Prioridad baja / futuro

- Galería de CGs desbloqueada por flags
- Música adaptativa (requiere migrar a Web Audio API)
- Soporte móvil / touch (tap targets más grandes)
- Modo de solo texto para accesibilidad

---

## 📝 Deuda técnica conocida

- **Engine** — `SPRITE_SHOW/HIDE` no esperan a que la animación termine antes de `next()`. Funciona en práctica pero puede causar race conditions en secuencias rápidas.

- **Audio** — `resolveAudioPath` hace `fetch HEAD` para detectar formato. Con Service Worker cache puede dar falsos negativos. Solución a largo plazo: guardar el formato en la DB junto al personaje.

- **MenuSystem** — `_cachedSaves` no se invalida si otro tab modifica la DB. No es problema en uso normal (VN es single-tab).

---

## 🎯 Próximo milestone — v0.2 Narrativa ramificada

1. `if/else/endif` en Parser + Engine
2. Seed de producción de la DB
3. Primera escena con ramificación real
4. Transición con fundido entre escenas
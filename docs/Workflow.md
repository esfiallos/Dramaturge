# Workflow de producción — Dramaturge

Guía de referencia para incorporar assets y contenido al proyecto. La regla general: cuantos menos pasos, menos errores. La mayoría de los assets se incorporan simplemente copiando archivos al lugar correcto.

---

## Assets que solo necesitan copiarse

No requieren tocar código ni base de datos. Solo el archivo en su carpeta.

### Fondos (bg)

```
public/assets/bg/
    mansion_entrada.webp
    bosque_noche.webp
    sala_reloj.webp
```

En el script: `bg.set mansion_entrada` o `bg.set mansion_entrada fade 1.5s`

El renderer prueba automáticamente `webp → png → jpg → jpeg`. Usar webp siempre — mejor compresión.

### Música (bgm)

```
public/assets/audio/bgm/
    track_01.mp3
    tension_01.mp3
```

En el script: `audio.bgm play[track_01]` o `audio.bgm play[track_01] 0.4`

### Efectos de sonido (se)

```
public/assets/audio/se/
    rain_ambience.mp3
    clock_tick.mp3
    door_open.mp3
```

En el script: `audio.se play[rain_ambience]` o `audio.se play[rain_ambience] 0.5`


### CGs (imágenes de escena)

```
public/assets/cg/
    cg_01.webp
    cg_reunion.webp
```

En el script: `unlock cg_01` o `unlock cg_reunion title:"La reunión"`

El CG se registra en la galería permanente al ejecutarse esa línea por primera vez. Las siguientes veces el motor lo ignora. El jugador puede verlo desde Galería en el menú principal en cualquier momento.

Usar webp siempre. El renderer también prueba png si webp falla.

### Voces

```
public/assets/audio/voice/
    VAL_001.mp3
    VAL_002.mp3
    MIK_001.mp3
```

En el script el número va entre corchetes: `valeria:neutral "Texto." [001]`

El prefijo (`VAL_`, `MIK_`) viene del personaje en la base de datos. El exportador de voces en el editor genera el CSV con todos los IDs y textos listos para grabar.

---

## Personajes — el único workflow con pasos

Los personajes son los únicos assets que requieren registro en base de datos, porque el motor necesita saber qué poses tiene cada uno y dónde están sus sprites.

### Paso 1 — Crear la carpeta de sprites

```
public/assets/sprites/
    aldric/
        neutral.webp
        serio.webp
        sorpresa.webp
```

Convención: carpeta con el ID del personaje en minúsculas, archivos en snake_case con extensión.

### Paso 2 — Registrar en la DB

Abrir `/dev/characters.html`.

Al escribir el ID (`aldric`), los campos **basePath** y **voicePrefix** se derivan automáticamente:

- basePath → `/assets/sprites/aldric/`  
- voicePrefix → `ALD_`

Si los nombres no son los correctos, se editan directamente. Son campos de texto normales.

Para las poses, cada fila es un par **alias → archivo**. El alias es lo que se escribe en el script; el archivo es el nombre real en la carpeta. Al salir del campo de alias, el campo de archivo se completa automáticamente como `alias.webp` — editar si el nombre real es distinto.

Guardar. El personaje queda disponible inmediatamente en `pawn aldric`.

### Paso 3 — Sincronizar con seed.js (cuando corresponda)

El botón **Exportar seed.js** en `/dev/characters.html` genera el bloque de código para pegar en `src/core/database/seed.js`. Esto es el backup del estado de la DB — sirve para que alguien que clone el repo o borre IndexedDB pueda restaurar los personajes sin pasar por la UI.

No es necesario hacerlo en cada cambio. Hacerlo como checkpoint cuando el elenco está estable o antes de un despliegue.

---

## Scripts (lenguaje Koedan)

Los scripts viven en `public/scripts/` organizados por capítulo:

```
public/scripts/
    cap01/
        scene_01.dan
        scene_02.dan
        scene_02_pass.dan
        scene_02_fail.dan
    cap02/
        scene_01.dan
```

El goto usa la ruta relativa sin extensión: `goto cap01/scene_02_pass`

Para escribir y probar scripts sin ejecutar el juego completo: `/dev/editor.html`

---


## PWA — instalación como app

El juego incluye `manifest.json` con `orientation: landscape` y `display: standalone`. Para que el navegador ofrezca el botón "Instalar aplicación" se necesitan dos pasos pendientes:

1. Crear los iconos en `public/assets/icons/`:
   - `icon-192.png` — 192×192 px, logo del juego
   - `icon-512.png` — 512×512 px, misma imagen

2. Añadir un Service Worker. Sin SW la instalación no es posible. Un SW básico de cache-first para los assets es suficiente — hay plantillas en Vite con el plugin `vite-plugin-pwa`.

Sin completar estos pasos el juego funciona normalmente en el navegador — solo no aparece la opción de instalar.

## Errores comunes

**Sprite no aparece:**  
El alias en el script (`valeria:triste`) no coincide con el alias registrado en la DB. Abrir `/dev/characters.html`, verificar que el alias existe y que el archivo también existe en la carpeta.

**Audio no suena:**  
El nombre en el script no coincide con el nombre del archivo. El motor no da error visible — simplemente no reproduce. Verificar nombre exacto en la carpeta.

**Personaje no encontrado:**  
`pawn aldric` fallará si `aldric` no está en la DB. Registrarlo en `/dev/characters.html` antes de escribir la escena.

**CG no aparece en galería:**
La instrucción `unlock` solo escribe en la DB si el CG no estaba desbloqueado. Si el archivo se añadió después de que el jugador ya pasó por esa línea, el CG está desbloqueado pero la imagen no existía. Solución: borrar la entrada en `/dev/debug.html` o usar el panel de IndexedDB del navegador (DevTools → Application → IndexedDB → DramaturgeDB → gallery).

**bg.set no cambia el fondo:**  
El archivo no existe en `public/assets/bg/` o el nombre difiere (mayúsculas, extensión). El renderer prueba todos los formatos pero el nombre base debe coincidir exactamente.

---

## Herramientas de desarrollo

| URL | Función |
|-----|---------|
| `/dev/editor.html` | Editor de scripts con preview, exportador de VO |
| `/dev/characters.html` | Gestión de personajes, exportar seed |
| `/dev/canvas.html` | Vista del renderer PixiJS con HUD de prueba |
| `/dev/debug.html` | Consola de estado del engine en tiempo real |
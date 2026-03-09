# Dramaturge

> Motor de novelas visuales con sistema de puzzles, scripting propio y estética de misterio/realeza.  
> Construido con JavaScript vanilla + Vite + PixiJS v8.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Bundler | Vite (MPA mode) |
| Render 2D | PixiJS v8 |
| UI / Texto | DOM puro |
| Persistencia | Dexie v2 (IndexedDB) |
| Estilos | CSS puro + Cinzel / Crimson Pro |
| Scripting | Lenguaje `.dan` propio (Table-Driven Parser) |

---

## Estructura del proyecto

```
/
├── index.html                  ← Viewport de producción
├── vite.config.js
├── package.json
├── public/
│   ├── scripts/                ← Archivos .dan del juego
│   │   └── cap01/
│   │       └── scene_01.dan
│   └── assets/
│       ├── bg/                 ← Fondos (jpg, png, webp)
│       ├── sprites/
│       │   ├── v/              ← Sprites de Valeria
│       │   └── m/              ← Sprites de Miki
│       └── audio/
│           ├── bgm/            ← Música de fondo
│           ├── se/             ← Efectos de sonido
│           └── voice/          ← Líneas de voz
├── src/
│   ├── main.js                 ← Bootstrap de producción
│   ├── style.css               ← Sistema de diseño
│   ├── core/
│   │   ├── Engine.js           ← Despachador central
│   │   ├── State.js            ← GameState
│   │   ├── SaveManager.js      ← Dexie + export/import JSON
│   │   ├── SceneManager.js     ← Carga de archivos .dan
│   │   ├── models/
│   │   │   └── Character.js
│   │   ├── parser/
│   │   │   ├── Parser.js       ← Table-Driven pattern
│   │   │   └── Grammar.js      ← Regex nombrados por tipo
│   │   └── database/
│   │       └── db.js           ← Schema Dexie v2
│   └── modules/
│       ├── Renderer.js         ← PixiJS v8 + DOM overlay
│       ├── Audio.js            ← 3 canales: bgm / voice / se
│       ├── PuzzleSystem.js     ← 3 tipos de puzzle
│       └── MenuSystem.js       ← Menú principal + pausa + slots
└── dev/
    ├── index.html              ← IDE del laboratorio
    └── lab.js                  ← Test harness con seed de DB
```

---

## Setup

```bash
npm install
npm run dev       # Abre localhost:5173/dev/ (lab)
npm run build     # Build de producción
npm run preview   # Preview del build
```

El servidor de desarrollo abre automáticamente el **laboratorio** (`/dev/`), no el juego de producción. Para ver el juego ve a `localhost:5173/`.

---

## Personajes en la DB

Los personajes viven en Dexie (`db.characters`). Se insertan desde el lab o desde un script de seed. Estructura:

```js
{
    id:          'valeria',
    name:        'Valeria',
    basePath:    '/assets/sprites/v/',
    voicePrefix: 'VAL_',
    poses: [
        { alias: 'neutral', file: 'v_idle.png' },
        { alias: 'triste',  file: 'v_sad.png'  },
    ]
}
```

- `basePath` debe tener la barra final y empezar con `/`
- `voicePrefix` + el id de voz del diálogo = nombre del archivo de audio

---

## Puzzles en la DB

```js
// Opción múltiple
{ puzzleId: 'P01', type: 'MULTIPLE_CHOICE', title: '...', description: '...', options: ['A','B','C'], answer: 1 }

// Texto libre (case-insensitive, trim automático)
{ puzzleId: 'P02', type: 'FREE_TEXT', title: '...', description: '...', answer: 'aldric' }

// Inventario (se resuelve sin UI)
{ puzzleId: 'P03', type: 'INVENTORY', title: '...', description: '...', requiredItem: 'llave_maestra' }
```

---

## Formatos de assets soportados

| Tipo | Formatos | Orden de búsqueda |
|---|---|---|
| Imágenes (sprites, fondos) | webp, png, jpg, jpeg | webp → png → jpg → jpeg |
| Audio (bgm, se, voice) | mp3, ogg | mp3 → ogg |

El engine prueba los formatos automáticamente si el archivo no tiene extensión, o hace fallback a otros formatos si la extensión indicada no existe.

---

## Convenciones de rutas en `.dan`

```
# Fondos       → busca en /assets/bg/
bg.set forest

# BGM          → busca en /assets/audio/bgm/
audio.bgm play[track_01]

# SE           → busca en /assets/audio/se/
audio.se play[explosion]

# Sprites      → construidos desde basePath en DB
show valeria:neutral at center

# Voces        → /assets/audio/voice/{voicePrefix}{id}
valeria:neutral "Texto" [001]   → VAL_001.mp3/ogg
```

Para más detalle de la sintaxis ver [`docs/SINTAXIS.md`](docs/SINTAXIS.md).

---

## Laboratorio de desarrollo

El lab en `/dev/` permite escribir y ejecutar scripts `.dan` en tiempo real sin tocar el juego de producción. Incluye:

- Editor con syntax highlighting
- Consola de instrucciones parseadas
- Seed automático de DB (personajes + puzzles de prueba)
- Overlay de puzzles funcional
- Reset de estado con un clic

> ⚠️ El lab limpia los saves al iniciar. No usar como entorno de prueba de guardado.

---


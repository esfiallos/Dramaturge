# Sintaxis del lenguaje `.ems`

Referencia completa del lenguaje de scripting de VEMN.  
Los archivos `.ems` viven en `public/scripts/` y se cargan por fetch en tiempo de ejecución.

---

## Reglas generales

- Una instrucción por línea
- Las líneas vacías y las que empiezan con `#` son ignoradas (comentarios)
- Los textos entre comillas soportan cualquier carácter incluyendo tildes y `¿¡`
- Los nombres de actores, poses, slots y flags son `snake_case` o `camelCase` — sin espacios
- Las rutas de escenas usan `/` como separador: `cap01/scene_02`

---

## Tabla completa de instrucciones

### Personajes

```ems
# Cargar actores en memoria desde la DB
# Deben cargarse antes de usarlos con show o diálogo
pawn valeria
pawn valeria, miki
```

```ems
# Mostrar sprite en pantalla
# slot: left | center | right
# effect: fade | slide | (vacío = instantáneo)
show valeria:neutral at center
show valeria:neutral at left fade
show miki:neutral at right slide
```

```ems
# Ocultar sprite
hide valeria
hide valeria fade
```

---

### Diálogo y narración

```ems
# Diálogo con pose (obligatoria) y voz (opcional)
# La pose actualiza el sprite si el actor está en pantalla
valeria:neutral "Texto del diálogo."
valeria:triste  "Texto del diálogo." [001]

# [001] = id de voz → busca /assets/audio/voice/VAL_001.mp3
```

```ems
# Narración — modo full screen, sin nombre, texto centrado en cursiva
# Estilo Umineko
narrate "El silencio lo cubría todo como una mortaja."
```

---

### Escena y audio

```ems
# Cambiar fondo
# target = nombre del archivo sin extensión, buscado en /assets/bg/
# effect: fade | (vacío = instantáneo)
# time: duración del fade (2s, 500ms, 1.5s)
bg.set forest
bg.set mansion fade:2s
bg.set void fade:500ms
```

```ems
# Audio — Música de fondo (loop)
# param = nombre del archivo sin extensión, buscado en /assets/audio/bgm/
# vol = 0.0 a 1.0 (por defecto 0.5)
audio.bgm play[track_01]
audio.bgm play[track_01] vol:0.4

# Audio — Efecto de sonido (one-shot)
# param = nombre del archivo sin extensión, buscado en /assets/audio/se/
audio.se play[explosion]
audio.se play[thunder] vol:0.9
```

---

### Control de flujo

```ems
# Pausa — bloquea el avance durante el tiempo indicado
wait 2s
wait 500ms
wait 1.5s
```

```ems
# Puzzle — bloquea hasta que el jugador lo resuelva
# El id debe existir en db.puzzles
# passText y failText se muestran como narración tras resolver
puzzle P01 pass:"¡Lo lograste!" fail:"Casi. Sigamos."
```

```ems
# Salto de escena — carga otro archivo .ems
# La ruta es relativa a /public/scripts/
goto cap01/scene_02
goto intro
goto cap02/final
```

---

### Estado del juego

```ems
# Flags — almacenados en GameState
# Los valores true/false/número se parsean automáticamente
set flag.puzzle_solved = true
set flag.capitulo = 2
set flag.nombre_npc = aldric

# Leer un flag en condiciones (futuro — ver TODO)
# if flag.puzzle_solved == true → goto cap01/scene_03
```

```ems
# Inventario
set inventory.add    llave_maestra
set inventory.remove llave_maestra
```

---

### Condicionales

```ems
# Comparar un flag
if flag.puzzle_solved == true
    goto cap01/scene_02_pass
else
    goto cap01/scene_02_fail
endif

# Comparaciones numéricas
if flag.intentos > 3
    narrate "Demasiados intentos. El tiempo se acaba."
endif

if flag.puntuacion >= 10
    set flag.rango = experto
endif

# Verificar inventario
if inventory.has llave_maestra
    goto sala_secreta
else
    narrate "La puerta no cede. Te falta algo."
endif
```

**Operadores soportados:** `==` `!=` `>` `<` `>=` `<=`

**Reglas:**
- Los bloques pueden anidarse
- El `else` es opcional
- Siempre cerrar con `endif`
- El motor evalúa `true`/`false` como booleanos, números como números, y el resto como strings

---

## Ejemplo de escena completa

```ems
# cap01/scene_01 — Llegada al bosque

pawn valeria, miki

bg.set forest fade:1s
audio.bgm play[misterio_01] vol:0.4

narrate "El camino se perdía entre los árboles, como si el bosque lo hubiera devorado."

show valeria:neutral at center fade
wait 1s

valeria:neutral "¿Miki? ¿Estás aquí?"

show miki:neutral at right slide

miki:neutral "Siempre tarde, Valeria." [001]

valeria:triste "No es culpa mía. El mapa estaba mal."

puzzle P01 pass:"Bien hecho. El camino se abre." fail:"No es correcto. Sigue pensando."

set flag.bosque_visitado = true
set inventory.add mapa_del_bosque

goto cap01/scene_02
```

---

## Convenciones recomendadas

| Elemento | Convención | Ejemplo |
|---|---|---|
| IDs de personaje | minúsculas | `valeria`, `guardian` |
| Aliases de pose | minúsculas | `neutral`, `triste`, `enojada` |
| IDs de puzzle | mayúsculas + número | `P01`, `P02` |
| Flags | snake_case | `puzzle_solved`, `cap2_iniciado` |
| Items de inventario | snake_case | `llave_maestra`, `mapa_viejo` |
| IDs de voice | 3 dígitos | `[001]`, `[042]` |
| Nombres de archivos de audio/bg | snake_case | `track_01`, `mansion_oscura` |
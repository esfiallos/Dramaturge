# Koedan — Referencia del lenguaje

Koedan es el lenguaje de scripting de Dramaturge. Los archivos tienen extensión `.dan` y viven en `public/scripts/`. Una instrucción por línea. Las líneas vacías y las que empiezan con `#` son comentarios ignorados por el parser.

Los nombres de actores, poses, flags e ítems van en `snake_case` sin espacios. Las rutas de escenas usan `/` como separador.

---

## Personajes

### Cargar actores en memoria

```
pawn valeria
pawn valeria, miki
pawn valeria, miki, aldric
```

Los personajes deben estar registrados en la base de datos (via `/dev/characters.html`). El `pawn` los carga en memoria — es obligatorio antes de usar `show` o escribir sus diálogos. Se puede cargar varios en una sola línea.

### Mostrar sprite

```
show valeria:neutral at center
show valeria:neutral at left fade
show miki:neutral at right slide
```

El slot puede ser `left`, `center` o `right`. El efecto es opcional: `fade` o `slide`. Sin efecto, el sprite aparece instantáneamente.

La pose (`neutral`, `triste`, etc.) debe existir en la DB para ese personaje.

### Ocultar sprite

```
hide valeria
hide valeria fade
```

---

## Diálogo y narración

### Diálogo

```
valeria:neutral "El mapa estaba mal. No es culpa mía."
valeria:triste  "Vine sola. Supongo que así tenía que ser." [001]
```

La pose es obligatoria. Si el actor está en pantalla, el sprite cambia a esa pose automáticamente.

El ID de voz entre corchetes es opcional. Si se incluye, el motor busca el archivo `{voicePrefix}{id}.mp3` — por ejemplo `[001]` con Valeria busca `VAL_001.mp3` en `/assets/audio/voice/`.

### Narración

```
narrate "La mansión Voss llevaba décadas abandonada. Nadie entraba por voluntad propia."
```

La narración activa el modo pantalla completa: el textbox ocupa más espacio, el texto va en cursiva y centrado, los sprites se atenúan. Si se venía de diálogo, hay una transición de modo con fundido.

---

## Escena y audio

### Fondo

```
bg.set forest
bg.set mansion_entrada fade 2s
bg.set void fade 500ms
```

El nombre es el archivo sin extensión en `/assets/bg/`. El efecto y el tiempo son opcionales. Sin efecto el cambio es instantáneo. El renderer prueba automáticamente webp, png, jpg, jpeg.

El separador entre efecto y tiempo puede ser espacio (`fade 2s`) o dos puntos (`fade:2s`) — ambas formas son equivalentes.

### Música de fondo

```
audio.bgm play[track_01]
audio.bgm play[track_01] 0.4
audio.bgm play[track_01] vol:0.4
```

El nombre es el archivo sin extensión en `/assets/audio/bgm/`. El volumen (0.0–1.0) es opcional y por defecto 0.5. La música es en loop continuo. Al pausar el juego el BGM se atenúa automáticamente.

El prefijo `vol:` es opcional — `0.4` y `vol:0.4` son equivalentes.

### Efectos de sonido

```
audio.se play[rain_ambience]
audio.se play[thunder] 0.9
```

El nombre es el archivo sin extensión en `/assets/audio/se/`. Reproducción one-shot, no interrumpe la música ni la voz.

---

## Control de flujo

### Pausa

```
wait 2s
wait 500ms
wait 1.5s
```

Bloquea el avance durante el tiempo indicado. En modo skip la pausa se omite automáticamente.

### Salto de escena

```
goto cap01/scene_02
goto cap02/final_bueno
goto cap02/scene_01 fade:black
goto cap02/scene_01 fade:white
```

Carga otro archivo `.dan`. La ruta es relativa a `public/scripts/` y no incluye la extensión.

El parámetro `fade` es opcional. Cuando se incluye, el motor ejecuta una transición estructural antes de cargar la escena nueva:

- La pantalla se funde al color indicado (~800ms)
- Los sprites, fondo y estado visual del capítulo anterior se limpian mientras el color cubre la pantalla
- La escena nueva carga y su primera instrucción se ejecuta automáticamente al terminar el fade
- El input queda bloqueado durante toda la transición — el skip no puede saltársela

Usar `fade:black` o `fade:white` para cambios de capítulo o saltos narrativos importantes. Los `goto` sin fade siguen siendo instantáneos y son adecuados para ramificaciones dentro del mismo capítulo.

### Puzzle

```
puzzle P01 pass:"¡Lo lograste!" fail:"Casi. Sigue pensando."
```

Abre el puzzle con ese ID (debe existir en la base de datos). El texto de `pass` o `fail` se muestra como narración al resolver. El resultado queda en `flag.P01_result` como `true` o `false`, disponible para condicionales inmediatamente después.

Tipos de puzzle soportados: `MULTIPLE_CHOICE`, `FREE_TEXT`, `INVENTORY`.

---

## Estado del juego

### Flags

```
set flag.bosque_visitado = true
set flag.capitulo = 2
set flag.nombre_npc = aldric
```

Los valores `true`/`false` se guardan como booleanos. Los números como números. Cualquier otra cosa como string. Los flags persisten en el save.

### Inventario

```
set inventory.add    llave_maestra
set inventory.remove llave_maestra
```

El inventario es un array de strings sin duplicados. Persiste en el save.

---


### Desbloquear CG

```
unlock cg_01
unlock cg_reunion title:"La reunión"
```

Desbloquea una imagen en la galería permanente. El CG queda disponible en la pantalla de Galería del menú principal y sobrevive a cualquier acción del jugador — nueva partida, borrar saves, cambiar de navegador no aplica (ver limitaciones de IndexedDB).

El `title` es opcional. Si se omite, la galería muestra el ID como etiqueta. La imagen debe existir en `/assets/cg/` con el nombre del ID.

A diferencia de `set flag.*`, el desbloqueo es irreversible por diseño — no hay instrucción para bloquear de nuevo un CG.

## Condicionales

```
if flag.miki_confio == true
    valeria:neutral "Miki dijo que la respuesta estaba aquí."
else
    valeria:triste "Vine sola."
endif
```

```
if flag.intentos > 3
    narrate "Demasiados intentos. El tiempo se acaba."
endif
```

```
if inventory.has llave_maestra
    goto sala_secreta
else
    narrate "La puerta no cede. Te falta algo."
endif
```

El `else` es opcional. Siempre cerrar con `endif`. Los bloques pueden anidarse. El motor evalúa `true`/`false` como booleanos, números como números, el resto como strings.

**Operadores soportados:** `==` `!=` `>` `<` `>=` `<=`

---

## Convenciones

| Elemento | Formato | Ejemplo |
|---|---|---|
| ID de personaje | minúsculas, snake_case | `valeria`, `guardian_norte` |
| Alias de pose | minúsculas | `neutral`, `triste`, `sorpresa` |
| ID de puzzle | mayúsculas + número | `P01`, `P02` |
| Flag | snake_case | `bosque_visitado`, `cap2_iniciado` |
| Ítem de inventario | snake_case | `llave_maestra`, `mapa_viejo` |
| ID de voz | 3 dígitos entre corchetes | `[001]`, `[042]` |
| Nombre de audio/bg | snake_case sin extensión | `track_01`, `mansion_entrada` |
| Ruta de escena | carpeta/nombre sin extensión | `cap01/scene_02` |

---

## Ejemplo de escena completa

El siguiente script es funcional y cubre las instrucciones principales del lenguaje.

```
# cap02/scene_01.dan — La mansión Voss

pawn valeria, miki

bg.set forest fade 2s
audio.bgm play[track_01] 0.35

narrate "La mansión Voss llevaba décadas abandonada. Nadie entraba por voluntad propia."

narrate "Valeria entró."

show valeria:neutral at center fade

if flag.miki_confio == true
    valeria:neutral "Miki dijo que la respuesta estaba aquí. Confío en eso."
else
    valeria:triste "Vine sola. Supongo que así tenía que ser."
endif

narrate "Las paredes guardaban retratos de una familia que el pueblo prefería olvidar."

valeria:neutral "Aldric. Ese nombre aparece en todos los marcos." [001]

audio.se play[rain_ambience] 0.5
puzzle P02 pass:"El nombre resonó en la sala." fail:"Silencio. No era ese nombre."

if flag.P02_result == true
    set flag.conoce_aldric = true
    narrate "Algo se desbloqueó. No una puerta — una memoria que no era suya."
    valeria:sorpresa "¿Cómo sé ese nombre? Nunca lo había escuchado."
else
    set flag.conoce_aldric = false
    valeria:triste "Me estoy perdiendo algo importante."
endif

if flag.miki_confio == true
    show miki:neutral at right slide
    miki:neutral "Te dije que estarías aquí."
    valeria:sorpresa "¿Cómo sabes lo de la llave?"
    miki:neutral "Porque yo la puse ahí."
    wait 0.6s
    hide miki fade
    narrate "Valeria se quedó sola con esa respuesta."
endif

if inventory.has llave_maestra
    puzzle P03 pass:"El mecanismo cedió. Detrás del reloj, un pasadizo." fail:"La llave no giró."
else
    narrate "La ranura estaba ahí, esperando algo que Valeria no tenía."
    valeria:triste "Necesito encontrar la llave primero."
endif

if flag.P03_result == true
    set flag.pasadizo_abierto = true
    valeria:sorpresa "Ahí estás. Finalmente."
else
    valeria:triste "Volveré. Y esta vez traeré lo que necesito."
endif

set flag.cap02_completo = true

wait 1s

narrate "Aldenmoor guarda sus muertos con cuidado. Pero los vivos son más difíciles de contener."
```
# Contribuir a Dramaturge

Antes de empezar, lee esto — es corto y evita trabajo innecesario.

---

## Lo primero: abre un Issue

**Antes de escribir una línea de código**, abre un Issue describiendo lo que propones.
Para bugs incluye pasos de reproducción. Para features, explica el caso de uso concreto.

Espera confirmación antes de implementar. El proyecto tiene una dirección técnica
definida — algunos cambios no encajan aunque sean correctos técnicamente.

La única excepción son correcciones de documentación obvias. Esas puedes mandarlas
directamente como PR.

---

## Setup

```bash
git clone https://github.com/tu-usuario/dramaturge
cd dramaturge
npm install
npm run dev        # editor en /dev/editor.html, juego en localhost:5173/
npm test           # suite de tests con Vitest
npm run test:watch # modo watch para desarrollo
```

La DB se puebla automáticamente en el primer arranque desde `seed.js`.

---

## Qué PRs se aceptan

### Sin Issue previo
- Correcciones de documentación
- Bugs con reproducción clara y fix acotado
- Mejoras a las herramientas de desarrollo (`/dev/`)
- Nuevas instrucciones Koedan siguiendo el patrón de tres archivos
- Nuevos tests

### Requieren Issue y confirmación
- Nuevos tipos de puzzle
- Cambios al schema de la DB
- Cambios al sistema de audio
- Cambios al ciclo de avance de `Engine.js` o `InstructionExecutor.js`
- Cambios de diseño visual

### No se aceptan
- Frameworks en el motor (React, Vue, Svelte…)
- Migración a TypeScript sin coordinación previa
- Cambios de paleta, fuentes o layout del juego
- Dependencias nuevas sin discusión previa

---

## Añadir una instrucción al lenguaje Koedan

Siempre son exactamente **tres archivos**, en este orden:

```
src/core/parser/Grammar.js        ← regex con named groups (?<nombre>)
src/core/parser/Parser.js         ← entrada en PARSE_RULES
src/core/InstructionExecutor.js   ← entrada en #buildHandlerMap() + método privado
```

Ejemplo completo para una instrucción hipotética `fx_rain`:

**Grammar.js:**
```js
FX_RAIN: /^fx\s+rain\s+(?<intensity>light|heavy)(?:\s+(?<duration>\d+(?:\.\d+)?(?:s|ms)))?/,
```

**Parser.js:**
```js
{ regex: KDN_GRAMMAR.FX_RAIN, type: 'FX_RAIN' },
```

**InstructionExecutor.js — en `#buildHandlerMap()`:**
```js
['FX_RAIN', (i) => this.#handleFxRain(i)],
```

**InstructionExecutor.js — método privado:**
```js
async #handleFxRain(instruction) {
    await this.#renderer.fxRain(instruction.intensity, parseDurationMs(instruction.duration));
    await this.#hooks.advance();
}
```

Si la instrucción cambia el lenguaje → actualizar `docs/KOEDAN.md` en el mismo PR.

---

## La regla más importante del executor

Todos los handlers de `InstructionExecutor` deben terminar llamando
**exactamente una** de estas dos funciones:

```js
await this.#hooks.advance();        // ejecutar la instrucción siguiente
await this.#hooks.jumpTo(index);    // saltar a índice y continuar
```

**Nunca llamar `engine.next()`** desde el executor — el re-entrancy guard
lo descartará silenciosamente y el juego se quedará colgado en esa instrucción
sin ningún error visible en consola. Es el bug más difícil de diagnosticar.

Para instrucciones bloqueantes (diálogo, narración, puzzle), el handler
llama `hooks.setBlocked(true)` y NO llama `advance()` — la reanudación
ocurre cuando el jugador hace clic y `engine.next()` se llama desde fuera.

```js
// Patrón correcto para instrucción bloqueante:
async #handleDialogue(instruction) {
    this.#hooks.setBlocked(true);
    await this.#renderer.typewriter(name, text, () => {
        this.#hooks.setBlocked(false);
        this.#hooks.onTextComplete();  // ← esto programa el siguiente avance
    });
    // No hay hooks.advance() aquí — el avance viene del clic del jugador
}
```

---

## Tests

El proyecto usa **Vitest**. Los archivos de test viven en `tests/`.

Para añadir tests de una instrucción nueva:

```js
// tests/InstructionExecutor.test.js — añadir al describe correspondiente
it('FX_RAIN llama renderer.fxRain con los parámetros correctos', async () => {
    const { executor, renderer } = createExecutor();
    await executor.dispatch({ type: 'FX_RAIN', intensity: 'heavy', duration: '2s' });
    expect(renderer.fxRain).toHaveBeenCalledWith('heavy', 2000);
});
```

Los mocks de hooks y renderer están en el mismo archivo — reutilizar
`createExecutor()` y `createMockHooks()` en lugar de crear nuevos.

Para instrucciones que evalúan condiciones, añadir casos en
`tests/ConditionEvaluator.test.js`.

---

## Añadir un panel nuevo al MenuSystem

Los paneles (`SlotPanel`, `AudioPanel`, etc.) siguen un contrato común:
- `mount(parentElement)` — insertar en el DOM, llamar una sola vez
- `open(...)` — mostrar con datos frescos
- `hide()` — ocultar sin destruir
- `get isOpen()` — estado actual

Para añadir un panel nuevo:

1. Crear `src/modules/panels/MiPanel.js` siguiendo ese contrato
2. Instanciarlo en `MenuSystem.#mountPanels()`
3. Añadirlo a `MenuSystem.#handleEscapeKey()` con su `isOpen`
4. Bindearlo en los eventos correspondientes con `this.#bindClick()`

`#handleEscapeKey()` cierra paneles en orden de prioridad visual —
el más encima primero. El nuevo panel va en el lugar correcto de esa cadena.

---

## Modificar la base de datos

Si el cambio añade o modifica una tabla, **siempre añadir `version(N+1)`**.
Nunca modificar una versión ya publicada.

```js
// Correcto — nueva versión
db.version(4).stores({
    characters: 'id, name',
    puzzles:    'puzzleId, type',
    saves:      'slotId, savedAt',
    gallery:    'id, unlockedAt',
    nueva:      'id, campo',
});
```

---

## Sistema de animaciones en Renderer

Hay tres casos. Cada efecto nuevo va en el que le corresponde:

```
¿Objeto PixiJS? (Sprite, Container, stage)   → app.ticker.add(tick)
¿Elemento DOM con transición?                 → element.animate().finished
¿Texto carácter a carácter?                  → requestAnimationFrame
```

Las curvas de easing están centralizadas en el objeto `EASING` al inicio
de `Renderer.js`. Usar esas curvas — no definir nuevas inline.

---

## Convenciones de código

| Elemento | Convención | Ejemplo |
|---|---|---|
| Clases | `PascalCase` | `AudioManager`, `InstructionExecutor` |
| Campos privados | `#camelCase` | `#db`, `#handlers`, `#twRafId` |
| Métodos privados | `#camelCase` | `#advance()`, `#buildHandlerMap()` |
| Constantes de módulo | `UPPER_SNAKE` | `FADE_MS`, `EASING`, `SLOT_X` |
| Tipos de instrucción Koedan | `UPPER_SNAKE` | `SPRITE_SHOW`, `BG_CHANGE` |

Sin frameworks. Sin TypeScript por ahora. DOM puro en motor y herramientas dev.

---

## Formato de commits

```
feat(executor): añadir instrucción fx_rain
fix(renderer): fxFlash no resuelve si CSS deshabilitado
docs(koedan): documentar sintaxis de fx_rain
refactor(engine): extraer #onTextLineComplete
test(executor): añadir casos para FX_RAIN
```

`tipo(módulo): descripción en minúsculas`. Tipos: `feat` `fix` `docs` `refactor` `test`.

Un commit por cambio lógico. Un PR por feature — no mezclar cambios no relacionados.

---

## Abrir el PR

- Rama desde `main`: `feat/fx-rain`, `fix/renderer-flash`, `docs/arquitectura`
- Rellena el template — especialmente "Cómo probarlo"
- Si toca el lenguaje → actualizar `docs/KOEDAN.md` en el mismo PR
- Si toca el workflow de assets → actualizar `WORKFLOW.md` en el mismo PR
- Si añade tabla o modifica schema → versión incrementada en `db.js`

---

## Documentación de referencia

Antes de tocar código, leer lo que corresponda:

- [`KOEDAN.md`](KOEDAN.md) — lenguaje de scripting completo
- [`ARQUITECTURA.md`](ARQUITECTURA.md) — módulos, flujo, sistema de animaciones
- [`WORKFLOW.md`](WORKFLOW.md) — assets, personajes, seed
- [`TODO.md`](TODO.md) — roadmap activo
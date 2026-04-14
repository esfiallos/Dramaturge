// src/config/slots.js
//
//
// Para añadir un slot nuevo: editar solo este archivo.
// SlotPanel y MenuSystem lo importan — el cambio se propaga solo.

/**
 * @typedef {'autosave' | 'slot_1' | 'slot_2' | 'slot_3'} SlotId
 */

/**
 * Configuración de los slots de guardado.
 *
 * `IDS`           — orden en que se muestran al jugador.
 * `DISPLAY_NAMES` — texto visible en los paneles de guardado y carga.
 *
 * Object.freeze() hace explícito que son datos de configuración inmutables.
 * Intentar mutar una propiedad lanza un error en modo estricto, facilitando
 * el debugging si alguien lo intenta por accidente.
 *
 * @type {Readonly<{ IDS: readonly SlotId[], DISPLAY_NAMES: Readonly<Record<SlotId, string>> }>}
 */
export const SLOT_CONFIG = Object.freeze({
    IDS: Object.freeze(/** @type {SlotId[]} */ (['autosave', 'slot_1', 'slot_2', 'slot_3'])),
    DISPLAY_NAMES: Object.freeze({
        autosave: 'Autoguardado',
        slot_1:   'Ranura 1',
        slot_2:   'Ranura 2',
        slot_3:   'Ranura 3',
    }),
});
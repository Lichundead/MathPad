// Comprobaciones sin navegador ni dependencias. Corren dentro de `npm run sync`.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('./', import.meta.url);
const html = readFileSync(new URL('www/index.html', root), 'utf8');

// 1. Una tecla cuyo data-insert es LaTeX necesita data-text: es lo que se escribe
//    en las lineas de texto, que no son LaTeX. Sin el, entra "\theta" en crudo.
const keys = [...html.matchAll(/<div class="math-key[^"]*"([^>]*)>/g)].map(m => m[1]);
assert.ok(keys.length > 40, `se esperaban >40 teclas, hay ${keys.length}`);

const sinText = keys
    .map(a => [/data-insert="([^"]*)"/.exec(a)?.[1], /data-text=/.test(a)])
    .filter(([insert, tiene]) => insert && !tiene && /\\|#\?/.test(insert))
    .map(([insert]) => insert);
assert.deepEqual(sinText, [], `teclas LaTeX sin data-text: ${sinText.join(', ')}`);

// 2. Todo getElementById del JS existe en el HTML.
const js = readFileSync(new URL('www/js/app.js', root), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const faltan = [...new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))]
    .filter(id => !ids.has(id));
assert.deepEqual(faltan, [], `getElementById sin elemento: ${faltan.join(', ')}`);

// 3. Migracion v1 -> v2: la ruta donde se pierde el trabajo del estudiante.
//    Se ejecuta el app.js real; el cuerpo de DOMContentLoaded no llega a correr.
const ctx = { window: {}, document: { addEventListener() {} } };
runInNewContext(js, ctx);

// counter distinto de lines.length+1 a proposito: si no, un bug que lo recalcule
// en vez de conservarlo daria el mismo numero y pasaria inadvertido.
const v1 = {
    lines: [{ id: 3, rawText: '2x=4', type: 'math' }, { id: 5, rawText: 'x=2', type: 'math' }],
    counter: 7,
    studentCode: 'A1'
};
const [doc] = ctx.legacyToDocs(v1);
assert.equal(doc.name, 'Procedimiento 1');
assert.deepEqual(doc.lines, v1.lines, 'la migracion debe conservar las lineas intactas');
assert.equal(doc.counter, 7, 'debe conservar el contador, no recalcularlo');
// longitud, no deepEqual: el array viene del realm del vm y no comparte prototipo
assert.equal(ctx.legacyToDocs({ lines: [] }).length, 0, 'v1 vacio no crea documento');
assert.equal(ctx.legacyToDocs(null).length, 0, 'v1 ausente no crea documento');
assert.equal(ctx.newDoc('x').counter, 1, 'documento nuevo empieza en 1');

// 4. Mayusculas: el predicado corre sobre las teclas reales del teclado qwerty.
//    Si clasificara mal el espacio, setShift borraria la etiqueta «Espacio».
const qwerty = html.split('Teclado QWERTY')[1].split('Teclado Griego')[0];
const inserts = [...qwerty.matchAll(/data-insert="([^"]*)"/g)].map(m => m[1]);
assert.ok(inserts.includes(' ') && inserts.includes(','), 'faltan espacio o coma en el qwerty');
for (const v of inserts) {
    const esperado = /^[a-zñáéíóúü]$/.test(v);
    assert.equal(ctx.isCaseLetter(v), esperado, `isCaseLetter(${JSON.stringify(v)})`);
}
assert.equal(ctx.isCaseLetter(' '), false, 'el espacio no debe cambiar de caja');
assert.ok(inserts.filter(ctx.isCaseLetter).length >= 32, 'deberia haber 32+ letras');

// 5. La clave v1 nunca se borra: es la red de seguridad de la migracion.
assert.ok(!/removeItem\(\s*LEGACY_KEY/.test(js), 'no borres LEGACY_KEY');

console.log(`ok — ${keys.length} teclas, ${ids.size} ids, migracion v1→v2, mayusculas`);

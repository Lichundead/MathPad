// Comprobaciones sin navegador ni dependencias. Corren dentro de `npm run sync`.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
//    TextEncoder es global en el navegador, pero no en un contexto de vm pelado.
const ctx = { window: {}, document: { addEventListener() {} }, TextEncoder };
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

// 4. Reordenar no pierde ni duplica lineas.
const lineas = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
const orden = a => a.map(l => l.id).join(',');
assert.equal(orden(ctx.moveItem(lineas, 3, 1)), '1,4,2,3', 'subir del final al indice 1');
assert.equal(orden(ctx.moveItem(lineas, 0, 3)), '2,3,4,1', 'bajar del inicio al final');
assert.equal(orden(ctx.moveItem(lineas, 1, 1)), '1,2,3,4', 'mover al mismo sitio no cambia nada');
for (const [from, to] of [[-1, 0], [0, -1], [0, 4], [9, 0]]) {
    assert.equal(orden(ctx.moveItem(lineas, from, to)), '1,2,3,4', `fuera de rango ${from}->${to}`);
}
for (let from = 0; from < lineas.length; from++) {
    for (let to = 0; to < lineas.length; to++) {
        const out = ctx.moveItem(lineas, from, to);
        assert.equal(out.length, lineas.length, `mover ${from}->${to} cambia la cantidad`);
        assert.equal([...new Set(out.map(l => l.id))].length, 4, `mover ${from}->${to} duplica o pierde`);
    }
}
assert.equal(orden(lineas), '1,2,3,4', 'moveItem no debe mutar el arreglo original');

// 5. El nombre de archivo no puede llevar caracteres ilegales ni quedar cojo.
const ILEGALES = /[/\\:*?"<>|\u0000-\u001f]/;
for (const sucio of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\nb', 'a\tb']) {
    assert.ok(!ILEGALES.test(ctx.sanitizeFilePart(sucio)), `queda ilegal en ${JSON.stringify(sucio)}`);
}
assert.equal(ctx.sanitizeFilePart('  A1/B2  '), 'A1B2', 'recorta los bordes');
assert.equal(ctx.sanitizeFilePart('nombre...'), 'nombre', 'quita los puntos finales');
assert.equal(ctx.sanitizeFilePart(null), '', 'null da cadena vacia');

assert.equal(ctx.buildExportName('A1', 'Taller', 'pdf', '2026-09-19'), 'A1 - Taller.pdf');
assert.equal(ctx.buildExportName('', 'Taller', 'pdf', '2026-09-19'), 'Taller.pdf', 'sin codigo no deja « - »');
assert.equal(ctx.buildExportName('A1', '', 'pdf', '2026-09-19'), 'A1.pdf', 'sin nombre no deja « - »');
assert.equal(ctx.buildExportName('', '', 'pdf', '2026-09-19'), 'MathPad 2026-09-19.pdf', 'sin nada, la fecha');
assert.equal(ctx.buildExportName(' / ', ' \\ ', 'pdf', '2026-09-19'), 'MathPad 2026-09-19.pdf',
    'si solo habia caracteres ilegales, tampoco queda cojo');

// El limite de ~255 se mide en bytes: las acentuadas ocupan dos en UTF-8.
const largo = ctx.buildExportName('á'.repeat(200), 'é'.repeat(200), 'pdf', '2026-09-19');
assert.ok(new TextEncoder().encode(largo).length <= 255, `nombre de ${new TextEncoder().encode(largo).length} bytes`);
assert.ok(largo.endsWith('.pdf'), 'el recorte debe conservar la extension');
assert.ok(!ILEGALES.test(largo), 'el nombre final no lleva ilegales');

// 6. Toda url() de un CSS vendorizado apunta a un archivo real. Es el fallo que
//    dejo los iconos en cuadritos, y ahora ademas protege el reapuntado a mano de
//    las fuentes de KaTeX hacia vendor/mathlive/fonts: si alguien re-vendoriza
//    KaTeX desde node_modules, esto falla en vez de romperse en silencio.
const vendor = new URL('www/vendor/', root);
const cssFiles = readdirSync(vendor, { recursive: true }).filter(f => String(f).endsWith('.css'));
assert.ok(cssFiles.length >= 2, `se esperaban >=2 CSS vendorizados, hay ${cssFiles.length}`);

const rotas = [];
let recursos = 0;
for (const rel of cssFiles) {
    const archivo = new URL(rel, vendor);
    for (const u of new Set([...readFileSync(archivo, 'utf8').matchAll(/url\(([^)"']+)\)/g)].map(m => m[1]))) {
        recursos++;
        if (!existsSync(new URL(u, archivo))) rotas.push(`${rel} -> ${u}`);
    }
}
assert.deepEqual(rotas, [], `url() que no resuelven:\n  ${rotas.join('\n  ')}`);

// 7. Panel inferior: con una linea de texto activa el teclado propio estorba,
//    porque encima sale el del sistema. Y nunca puede quedar irrecuperable.
// cadena, no deepEqual: el objeto viene del realm del vm y no comparte prototipo
const panel = (tipo, plegado) => {
    const r = ctx.panelState(tipo, plegado);
    return `tabs=${r.tabs} keys=${r.keys}`;
};
assert.equal(panel('text', false), 'tabs=false keys=false', 'texto oculta el panel');
assert.equal(panel('text', true), 'tabs=false keys=false', 'texto manda sobre el plegado');
assert.equal(panel('math', false), 'tabs=true keys=true', 'matematica muestra el teclado');
assert.equal(panel(undefined, false), 'tabs=true keys=true', 'sin linea activa, visible');
assert.equal(panel('math', true), 'tabs=true keys=false', 'plegado deja las pestanas');

// El invariante: si las teclas estan ocultas por el plegado manual, la barra de
// pestanas -donde vive el boton de desplegar- tiene que seguir a la vista.
for (const tipo of ['math', 'text', undefined, null]) {
    for (const plegado of [true, false]) {
        const { tabs, keys } = ctx.panelState(tipo, plegado);
        if (!keys && tipo !== 'text') {
            assert.ok(tabs, `panel irrecuperable con tipo=${tipo} plegado=${plegado}`);
        }
    }
}

console.log(`ok — ${keys.length} teclas, ${ids.size} ids, migracion v1→v2, reordenar, nombres, panel, ${recursos} url() vendorizadas`);

/* MathPad — lógica principal (sin dependencias de red) */

const STORAGE_KEY = 'mathpad:docs:v2';
const LEGACY_KEY = 'mathpad:lines:v1';   // se conserva: red de seguridad si v2 se corrompe

// --- Configuración de MathLive para funcionar 100% offline ---
if (window.MathfieldElement) {
    MathfieldElement.fontsDirectory = 'vendor/mathlive/fonts';
    MathfieldElement.soundsDirectory = null;      // no empaquetamos sonidos
}

function newDoc(name, lines = [], counter = null) {
    return {
        id: Date.now() + Math.random(),
        name,
        lines,
        counter: counter || (lines.length + 1)
    };
}

// v1 guardaba un unico procedimiento suelto. Pura y fuera del closure a proposito:
// es la ruta donde se pierde el trabajo del estudiante si falla, y asi se comprueba.
function legacyToDocs(data) {
    if (!data || !Array.isArray(data.lines) || data.lines.length === 0) return [];
    return [newDoc('Procedimiento 1', data.lines, data.counter)];
}

// Mueve el elemento de `from` a `to` y devuelve un arreglo nuevo. Fuera de rango
// o sin movimiento, devuelve una copia intacta. La usan las flechas y el arrastre.
// Que se ve en el panel inferior, segun el tipo de linea activa y el plegado manual.
// Pura y fuera del closure a proposito: asi se comprueba que el boton de desplegar
// nunca desaparece a la vez que las teclas, que dejaria un teclado irrecuperable.
function panelState(activeType, collapsed) {
    const esTexto = activeType === 'text';
    return { tabs: !esTexto, keys: !esTexto && !collapsed };
}

function moveItem(arr, from, to) {
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr.slice();
    const out = arr.slice();
    out.splice(to, 0, out.splice(from, 1)[0]);
    return out;
}

// Un nombre de archivo no puede llevar separadores de ruta ni caracteres de control.
// Se quitan tambien los puntos finales, que Windows descarta en silencio.
function sanitizeFilePart(value) {
    return String(value == null ? '' : value)
        .replace(/[/\\:*?"<>|]/g, '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\.+$/, '')
        .trim();
}

// Recorta en bytes, no en caracteres: en UTF-8 una vocal acentuada ocupa dos y el
// limite de ~255 de muchos sistemas de archivos se mide en bytes.
// ponytail: quita de a un caracter; con un limite de 255 no compensa nada mejor.
function truncateBytes(text, maxBytes) {
    const enc = new TextEncoder();
    let out = text;
    while (enc.encode(out).length > maxBytes && out.length > 0) out = out.slice(0, -1);
    return out.trim();
}

// «codigo - nombre.ext». Si falta una parte se usa solo la otra, y si faltan las
// dos, un nombre con la fecha: nunca un « - algo.pdf» cojo.
function buildExportName(studentCode, docName, ext, today) {
    const parts = [sanitizeFilePart(studentCode), sanitizeFilePart(docName)].filter(Boolean);
    const base = parts.join(' - ') || `MathPad ${today}`;
    return `${truncateBytes(base, 255 - ext.length - 1)}.${ext}`;
}

document.addEventListener('DOMContentLoaded', () => {

    // --- Estado ---
    let linesData = [];          // copia de trabajo del documento activo
    let activeLineId = null;
    let lineCounter = 1;
    let activeInputForKeyboard = null;
    let docs = [];               // [{ id, name, lines, counter }]
    let activeDocId = null;

    // --- DOM ---
    const editorArea = document.getElementById('editor-area');
    const btnNewLine = document.getElementById('btn-new-line');
    const btnClear = document.getElementById('btn-clear');
    const keyboardGrid = document.getElementById('keyboard-grid');
    const tabBasic = document.getElementById('tab-basic');
    const tabGreek = document.getElementById('tab-greek');
    const greekGrid = document.getElementById('greek-grid');
    const btnRenderLine = document.getElementById('btn-render-line');
    const btnShare = document.getElementById('btn-share');
    const btnEvalIA = document.getElementById('btn-eval-ia');
    const studentCodeInput = document.getElementById('student-code');
    const captureStage = document.getElementById('capture-stage');
    const docSelect = document.getElementById('doc-select');
    const btnPdf = document.getElementById('btn-pdf');
    const keyboardTabs = document.getElementById('keyboard-tabs');
    const keyboardContainer = document.getElementById('keyboard-container');
    const btnToggleKeyboard = document.getElementById('btn-toggle-keyboard');
    let keyboardCollapsed = false;   // plegado manual, solo cuando el panel esta en juego
    const optLatex = document.getElementById('opt-latex');

    // --- Persistencia ---
    function currentDoc() {
        return docs.find(d => d.id === activeDocId);
    }

    function save() {
        const doc = currentDoc();
        if (doc) {
            doc.lines = linesData;
            doc.counter = lineCounter;
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                docs,
                activeDocId,
                studentCode: studentCodeInput.value,
                includeLatex: optLatex.checked
            }));
        } catch (e) {
            console.warn('No se pudo guardar:', e);
        }
    }

    // No borra LEGACY_KEY: si algo sale mal, el trabajo sigue ahi.
    function migrateLegacy() {
        try {
            const raw = localStorage.getItem(LEGACY_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data && data.studentCode) studentCodeInput.value = data.studentCode;
            docs = legacyToDocs(data);
        } catch (e) {
            console.warn('No se pudo migrar v1:', e);
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw) || {};
                if (Array.isArray(data.docs)) docs = data.docs;
                activeDocId = data.activeDocId;
                if (data.studentCode) studentCodeInput.value = data.studentCode;
                optLatex.checked = !!data.includeLatex;
            } else {
                migrateLegacy();
            }
        } catch (e) {
            console.warn('No se pudo cargar:', e);
        }

        if (docs.length === 0) docs = [newDoc('Procedimiento 1')];
        if (!currentDoc()) activeDocId = docs[0].id;

        loadDoc(activeDocId);
        return linesData.length > 0;
    }

    function renderDocSelect() {
        docSelect.innerHTML = '';
        docs.forEach(d => docSelect.add(new Option(d.name, d.id, false, d.id === activeDocId)));
        docSelect.add(new Option('✏️ Renombrar…', 'rename'));
        docSelect.add(new Option('➕ Nuevo…', 'new'));
    }

    function loadDoc(id) {
        activeDocId = id;
        const doc = currentDoc();
        linesData = doc.lines;
        lineCounter = doc.counter;
        activeLineId = null;
        renderDocSelect();
        renderEditor();
    }

    docSelect.addEventListener('change', () => {
        save();                      // vuelca el actual antes de soltarlo

        // Sin esto el documento inicial se llamaba siempre «Procedimiento 1» y no
        // habia forma de cambiarlo: de ahi que el nombre del PDF pareciera generico.
        if (docSelect.value === 'rename') {
            const nuevo = (prompt('Nuevo nombre:', currentDoc().name) || '').trim();
            if (nuevo) currentDoc().name = nuevo;
            renderDocSelect();       // deshace la seleccion de «Renombrar…»
            save();
            return;
        }

        if (docSelect.value !== 'new') {
            loadDoc(docs.find(d => String(d.id) === docSelect.value).id);
            save();                  // persiste cual quedo activo
            return;
        }
        const name = (prompt('Nombre del procedimiento:') || '').trim();
        if (!name) {
            renderDocSelect();       // deshace la seleccion de «Nuevo…»
            return;
        }
        const doc = newDoc(name);
        docs.push(doc);
        loadDoc(doc.id);
        createNewLine();             // guarda al final
    });

    // --- Edición ---
    function createNewLine(type = 'math') {
        const id = lineCounter++;
        linesData.push({ id, rawText: '', type });
        activeLineId = id;
        renderEditor();
        save();
    }

    // scrollToIndex: null = al final (linea nueva). Un indice = deja esa linea a la
    // vista, que es lo que hace falta al reordenar; el salto al final estorbaria.
    function renderEditor(scrollToIndex = null) {
        editorArea.innerHTML = '';
        activeInputForKeyboard = null;

        linesData.forEach((lineObj, index) => {
            const lineEl = document.createElement('div');
            lineEl.className = 'line-container' + (lineObj.id === activeLineId ? ' active' : '');
            lineEl.dataset.index = index;   // lo lee elementFromPoint al arrastrar

            const numEl = document.createElement('div');
            numEl.className = 'line-number';
            numEl.textContent = (index + 1) + '.';   // la profesora cuenta desde 1

            const contentEl = document.createElement('div');
            contentEl.className = 'line-content w-full flex items-center';

            if (lineObj.type === 'text') {
                // --- Línea de texto explicativo ---
                const input = document.createElement('input');
                input.type = 'text';
                input.value = lineObj.rawText;
                input.className = 'w-full bg-transparent outline-none text-gray-700 font-sans p-2 text-base';
                input.placeholder = index === 0
                    ? 'Escribe el enunciado del problema aquí...'
                    : 'Describe tu paso aquí (Ej. Despejando x)...';
                // Sin inputmode="none": el teclado del sistema es mejor para prosa
                // (autocorreccion, prediccion, acentos). Tampoco se le apaga la
                // correccion, que es justo lo que se venia a ganar.
                input.setAttribute('autocomplete', 'off');
                input.setAttribute('autocapitalize', 'sentences');

                if (lineObj.id === activeLineId) {
                    input.classList.add('border', 'border-gray-300', 'rounded', 'bg-gray-50');
                    activeInputForKeyboard = input;
                    input.addEventListener('input', (e) => {
                        lineObj.rawText = e.target.value;
                        save();
                    });
                    // El foco se pide al final de renderEditor(), de forma sincrona:
                    // Android solo abre el teclado del sistema si el focus() ocurre
                    // dentro del gesto del usuario, y un setTimeout lo saca de el.
                } else {
                    input.readOnly = true;
                    input.style.border = '1px solid transparent';
                    input.addEventListener('click', () => {
                        activeLineId = lineObj.id;
                        renderEditor();
                    });
                }
                contentEl.appendChild(input);

            } else {
                // --- Línea matemática (MathLive) ---
                const mf = document.createElement('math-field');
                mf.value = lineObj.rawText;
                mf.mathVirtualKeyboardPolicy = 'manual';

                if (lineObj.id === activeLineId) {
                    mf.className = 'inline-input';
                    mf.addEventListener('input', () => {
                        lineObj.rawText = mf.value;
                        save();
                    });
                    activeInputForKeyboard = mf;
                    setTimeout(() => {
                        mf.focus();
                        if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide();
                    }, 50);
                } else {
                    mf.readOnly = true;
                    mf.style.border = '1px solid transparent';
                    mf.style.padding = '8px';
                    mf.style.backgroundColor = 'transparent';
                    mf.style.outline = 'none';

                    const activateLine = () => {
                        if (activeLineId !== lineObj.id) {
                            activeLineId = lineObj.id;
                            renderEditor();
                        }
                    };
                    mf.addEventListener('focus', activateLine);
                    mf.addEventListener('click', activateLine);
                }
                contentEl.appendChild(mf);
            }

            const handle = document.createElement('div');
            handle.className = 'drag-handle w-6 shrink-0 self-stretch flex items-center justify-center text-gray-300 active:text-blue-600';
            handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
            handle.setAttribute('aria-label', `Arrastrar la línea ${index + 1}`);
            handle.addEventListener('pointerdown', (e) => startDrag(e, index));

            lineEl.appendChild(handle);
            lineEl.appendChild(numEl);
            lineEl.appendChild(contentEl);

            // --- Reordenar y borrar ---
            const actionEl = document.createElement('div');
            actionEl.className = 'flex items-center justify-center shrink-0';

            // Click normal, no bindKey: aqui se re-renderiza igual, no hay foco que conservar.
            const arrow = (icon, label, to) => {
                const b = document.createElement('button');
                b.className = 'w-10 h-10 rounded-full flex items-center justify-center text-gray-400 active:text-blue-600 disabled:opacity-25 transition-colors focus:outline-none';
                b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
                b.setAttribute('aria-label', label);
                b.disabled = to < 0 || to >= linesData.length;   // a la vista, no escondida
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveLine(index, to);
                });
                return b;
            };

            actionEl.appendChild(arrow('fa-chevron-up', `Subir la línea ${index + 1}`, index - 1));
            actionEl.appendChild(arrow('fa-chevron-down', `Bajar la línea ${index + 1}`, index + 1));

            const deleteBtn = document.createElement('button');
            deleteBtn.setAttribute('aria-label', `Borrar la línea ${index + 1}`);
            deleteBtn.className = 'text-gray-300 active:text-red-500 w-10 h-10 rounded-full flex items-center justify-center transition-colors focus:outline-none';
            deleteBtn.title = 'Borrar línea';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            if (lineObj.id === activeLineId) {
                deleteBtn.classList.replace('text-gray-300', 'text-red-400');
            }

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                linesData = linesData.filter(l => l.id !== lineObj.id);
                if (activeLineId === lineObj.id) {
                    activeLineId = null;
                    activeInputForKeyboard = null;
                }
                if (linesData.length === 0) {
                    createNewLine('math');
                } else {
                    renderEditor();
                    save();
                }
            });

            actionEl.appendChild(deleteBtn);
            lineEl.appendChild(actionEl);
            editorArea.appendChild(lineEl);
        });

        syncKeyboardPanel();

        // Sincrono y dentro del gesto que provoco el render: es la unica forma de
        // que Android abra el teclado del sistema. El math-field no lo necesita
        // (su teclado es el propio) y conserva su foco diferido.
        if (activeInputForKeyboard && activeInputForKeyboard.tagName === 'INPUT') {
            activeInputForKeyboard.focus();
        }

        if (scrollToIndex === null) {
            editorArea.scrollTop = editorArea.scrollHeight;
        } else {
            editorArea.children[scrollToIndex]?.scrollIntoView({ block: 'nearest' });
        }
    }

    // Unico sitio que decide que se ve en el panel inferior. Con una linea de texto
    // activa manda el teclado del sistema: apilarle encima el propio dejaba el
    // editor en una franja de una linea. La barra de acciones nunca se oculta,
    // asi queda apoyada justo sobre el teclado nativo.
    function syncKeyboardPanel() {
        const activa = linesData.find(l => l.id === activeLineId);
        const { tabs, keys } = panelState(activa && activa.type, keyboardCollapsed);

        keyboardTabs.style.display = tabs ? '' : 'none';
        keyboardContainer.style.display = keys ? '' : 'none';
        btnToggleKeyboard.innerHTML = keyboardCollapsed
            ? '<i class="fa-solid fa-chevron-up"></i>'
            : '<i class="fa-solid fa-chevron-down"></i>';
    }

    function moveLine(from, to) {
        const moved = linesData[from];
        linesData = moveItem(linesData, from, to);
        save();
        renderEditor(linesData.indexOf(moved));   // la linea movida queda a la vista
    }

    // --- Arrastrar para reordenar ---
    // No se re-renderiza durante el gesto: eso destruiria el math-field que esta bajo
    // el dedo y rompeia la captura del puntero. Solo se marca el destino, y se
    // confirma una unica vez al soltar.
    let drag = null;

    function markDropTarget(index) {
        [...editorArea.children].forEach((row, i) => row.classList.toggle('drop-target', i === index));
    }

    function startDrag(e, from) {
        if (linesData.length < 2) return;
        e.preventDefault();                       // sin esto el gesto se lo lleva el scroll
        drag = { from, to: from, handle: e.currentTarget };
        editorArea.children[from].classList.add('dragging');
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.addEventListener('pointermove', onDragMove);
        e.currentTarget.addEventListener('pointerup', endDrag);
        e.currentTarget.addEventListener('pointercancel', endDrag);
    }

    function onDragMove(e) {
        if (!drag) return;
        const row = document.elementFromPoint(e.clientX, e.clientY);
        const target = row && row.closest ? row.closest('.line-container') : null;
        if (target && target.dataset.index !== undefined) {
            drag.to = Number(target.dataset.index);
            markDropTarget(drag.to);
        }
        // Desplaza al acercarse a los bordes, para poder mover mas alla de lo visible.
        // ponytail: solo avanza mientras el dedo se mueve; si hiciera falta que siga
        // con el dedo quieto, un bucle con requestAnimationFrame.
        const box = editorArea.getBoundingClientRect();
        if (e.clientY < box.top + 48) editorArea.scrollTop -= 12;
        else if (e.clientY > box.bottom - 48) editorArea.scrollTop += 12;
    }

    function endDrag(e) {
        if (!drag) return;
        const { from, to, handle } = drag;
        drag = null;
        handle.removeEventListener('pointermove', onDragMove);
        handle.removeEventListener('pointerup', endDrag);
        handle.removeEventListener('pointercancel', endDrag);
        try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ya liberado */ }
        if (to !== from) moveLine(from, to);
        else renderEditor(from);                  // limpia las marcas del arrastre
    }

    // Salir del modo edicion. Devuelve si habia algo que cerrar (lo usa el boton atras).
    function deactivate() {
        if (activeLineId === null) return false;
        document.activeElement?.blur();   // cierra el teclado del sistema si estaba abierto
        activeLineId = null;
        renderEditor();
        return true;
    }

    function hasContent() {
        return linesData.some(l => l.rawText && l.rawText.trim() !== '');
    }

    // --- Evaluar: copiar el procedimiento como texto plano para una IA ---

    function buildPromptText() {
        const studentCode = studentCodeInput.value.trim();
        let promptText = '';

        if (studentCode !== '') {
            promptText += `Estudiante: ${studentCode}\n\n`;
        }

        linesData.forEach((line, index) => {
            if (line.rawText && line.rawText.trim() !== '') {
                if (line.type === 'text') {
                    promptText += `[Línea ${index + 1}] (Texto): ${line.rawText}\n`;
                } else {
                    promptText += `[Línea ${index + 1}] (Ecuación): $$ ${line.rawText} $$\n`;
                }
            }
        });

        return promptText;
    }

    // Capacitor sirve por https://localhost y `npm run serve` por http://localhost:
    // los dos son contextos seguros, asi que la API moderna siempre esta disponible.
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.error('Error al copiar:', e);
            return false;
        }
    }

    btnEvalIA.addEventListener('click', async () => {
        deactivate();

        if (!hasContent()) {
            showToast('No hay contenido para evaluar');
            return;
        }

        const ok = await copyToClipboard(buildPromptText());
        showToast(ok ? '¡Procedimiento copiado para la IA!' : 'No se pudo copiar el texto');
    });

    studentCodeInput.addEventListener('input', save);
    optLatex.addEventListener('change', save);

    // --- Compartir como imagen ---
    // html2canvas NO ve dentro del Shadow DOM de MathLive, así que reconstruimos
    // el procedimiento con KaTeX (DOM normal) en un lienzo oculto y capturamos eso.
    function buildCaptureStage(withLatex) {
        captureStage.innerHTML = '';
        linesData.forEach((lineObj, index) => {
            if (!lineObj.rawText || !lineObj.rawText.trim()) return;

            const row = document.createElement('div');
            row.className = 'capture-line';

            const num = document.createElement('div');
            num.className = 'capture-num';
            num.textContent = (index + 1) + '.';

            const body = document.createElement('div');
            if (lineObj.type === 'text') {
                body.textContent = lineObj.rawText;
                body.style.color = '#374151';
            } else {
                try {
                    body.innerHTML = katex.renderToString(lineObj.rawText, {
                        throwOnError: false,
                        displayMode: true,
                        macros: { '\\placeholder': '\\square' }
                    });
                } catch (e) {
                    body.textContent = lineObj.rawText;
                }
            }

            if (withLatex && lineObj.type !== 'text') {
                const tex = document.createElement('div');
                tex.className = 'capture-tex';
                tex.textContent = lineObj.rawText;
                body.appendChild(tex);
            }

            row.appendChild(num);
            row.appendChild(body);
            captureStage.appendChild(row);
        });
    }

    function exportName(ext) {
        return buildExportName(
            studentCodeInput.value,
            currentDoc()?.name ?? '',
            ext,
            new Date().toISOString().slice(0, 10)
        );
    }

    async function shareBlob(blob, fileName) {
        const cap = window.Capacitor;
        const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

        if (isNative) {
            // Ruta nativa: guardar en caché y abrir el diálogo de compartir de Android
            const base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
                reader.readAsDataURL(blob);
            });

            const { Filesystem, Share } = cap.Plugins;
            const written = await Filesystem.writeFile({
                path: fileName,
                data: base64,
                directory: 'CACHE'
            });
            await Share.share({
                title: 'Mi Procedimiento Matemático',
                files: [written.uri]
            });
            return;
        }

        // Ruta web (navegador de escritorio o móvil)
        const file = new File([blob], fileName, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: 'Mi Procedimiento Matemático', files: [file] });
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(fileName.endsWith('.pdf') ? 'PDF descargado' : 'Imagen descargada');
    }

    async function renderCanvas(withLatex = false) {
        buildCaptureStage(withLatex);
        await new Promise(r => setTimeout(r, 250)); // deja que KaTeX pinte
        return html2canvas(captureStage, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false
        });
    }

    btnShare.addEventListener('click', async () => {
        deactivate();

        if (!hasContent()) {
            showToast('No hay contenido para compartir');
            return;
        }

        showToast('Generando imagen...');
        try {
            const canvas = await renderCanvas();

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    showToast('Error al generar imagen');
                    return;
                }
                try {
                    await shareBlob(blob, exportName('png'));
                } catch (err) {
                    console.log('Compartir cancelado o falló:', err);
                }
            }, 'image/png');

        } catch (error) {
            console.error('Error html2canvas:', error);
            showToast('Error al procesar la imagen');
        }
    });

    btnPdf.addEventListener('click', async () => {
        deactivate();

        if (!hasContent()) {
            showToast('No hay contenido para exportar');
            return;
        }

        showToast('Generando PDF...');
        try {
            const canvas = await renderCanvas(optLatex.checked);
            const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
            const margin = 24;
            const width = pdf.internal.pageSize.getWidth() - margin * 2;
            const height = canvas.height * width / canvas.width;
            const usable = pdf.internal.pageSize.getHeight() - margin * 2;
            const img = canvas.toDataURL('image/png');

            // Paginado: la misma imagen alta, desplazada hacia arriba en cada pagina.
            // ponytail: puede partir una linea por la mitad; si molesta, paginar por
            // filas en buildCaptureStage en vez de por pixeles.
            pdf.addImage(img, 'PNG', margin, margin, width, height);
            for (let offset = usable; offset < height; offset += usable) {
                pdf.addPage();
                pdf.addImage(img, 'PNG', margin, margin - offset, width, height);
            }

            await shareBlob(pdf.output('blob'), exportName('pdf'));
        } catch (error) {
            console.error('Error al generar PDF:', error);
            showToast('Error al generar el PDF');
        }
    });

    // --- Teclado matemático ---
    // plainText = data-text de la tecla: su forma legible para las lineas de
    // texto, que no son LaTeX. Solo lo llevan las teclas donde ambas difieren.
    function insertTextAtCursor(textToInsert, plainText) {
        if (!activeInputForKeyboard) return;

        if (activeInputForKeyboard.tagName && activeInputForKeyboard.tagName.toLowerCase() === 'input') {
            const txt = plainText || textToInsert;

            const start = activeInputForKeyboard.selectionStart;
            const text = activeInputForKeyboard.value;
            activeInputForKeyboard.value = text.substring(0, start) + txt + text.substring(activeInputForKeyboard.selectionEnd);
            activeInputForKeyboard.selectionStart = activeInputForKeyboard.selectionEnd = start + txt.length;
            activeInputForKeyboard.dispatchEvent(new Event('input'));
            activeInputForKeyboard.focus();
            return;
        }

        activeInputForKeyboard.insert(textToInsert);
        activeInputForKeyboard.focus();
        activeInputForKeyboard.dispatchEvent(new Event('input'));
    }

    function deleteBackward() {
        if (!activeInputForKeyboard) return;

        if (activeInputForKeyboard.tagName && activeInputForKeyboard.tagName.toLowerCase() === 'input') {
            const start = activeInputForKeyboard.selectionStart;
            if (start > 0) {
                const text = activeInputForKeyboard.value;
                activeInputForKeyboard.value = text.substring(0, start - 1) + text.substring(activeInputForKeyboard.selectionEnd);
                activeInputForKeyboard.selectionStart = activeInputForKeyboard.selectionEnd = start - 1;
                activeInputForKeyboard.dispatchEvent(new Event('input'));
            }
            activeInputForKeyboard.focus();
            return;
        }

        activeInputForKeyboard.executeCommand('deleteBackward');
        activeInputForKeyboard.dispatchEvent(new Event('input'));
        activeInputForKeyboard.focus();
    }

    // Un solo listener por tecla. preventDefault() en pointerdown conserva el foco
    // del campo activo (cancela el mousedown de compatibilidad, que es quien lo
    // movería) y de paso evita el click sintético: con touchstart+preventDefault
    // Android cancelaba ese click y el handler no llegaba a ejecutarse nunca.
    function bindKey(el, handler) {
        const run = (e) => {
            e.preventDefault();
            handler();
        };
        if (window.PointerEvent) el.addEventListener('pointerdown', run);
        else el.addEventListener('click', run);
    }

    document.querySelectorAll('.math-key[data-insert]').forEach(btn => {
        bindKey(btn, () => {
            const { insert, text } = btn.dataset;
            if (activeLineId === null) {
                createNewLine('math');
                setTimeout(() => insertTextAtCursor(insert, text), 80);
                return;
            }
            insertTextAtCursor(insert, text);
        });
    });

    document.querySelectorAll('.btn-backspace').forEach(btn => bindKey(btn, deleteBackward));

    // --- UI general ---
    btnNewLine.addEventListener('click', () => createNewLine('math'));
    document.getElementById('btn-new-text').addEventListener('click', () => createNewLine('text'));

    btnRenderLine.addEventListener('click', deactivate);

    // Boton atras de Android: sale del modo edicion; solo cierra si no habia nada abierto.
    // Con un listener registrado, Capacitor deja de cerrar la app por su cuenta.
    const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (capApp) {
        capApp.addListener('backButton', () => {
            if (!deactivate()) capApp.exitApp();
        });
    }

    btnClear.addEventListener('click', () => {
        if (docs.length > 1) {
            if (!confirm(`¿Borrar el procedimiento «${currentDoc().name}»?`)) return;
            docs = docs.filter(d => d.id !== activeDocId);
            loadDoc(docs[0].id);
            save();
            showToast('Procedimiento borrado');
            return;
        }

        if (confirm('¿Estás seguro de borrar todo el procedimiento?')) {
            linesData = [];
            lineCounter = 1;
            activeLineId = null;
            save();
            showToast('Pizarra limpia');
            createNewLine();
        }
    });

    btnToggleKeyboard.addEventListener('click', () => {
        keyboardCollapsed = !keyboardCollapsed;
        syncKeyboardPanel();
    });

    // El teclado del sistema al abrirse o cerrarse cambia el alto util. visualViewport
    // es el unico aviso fiable en Android; sin esto la linea en edicion queda tapada.
    window.visualViewport?.addEventListener('resize', () => {
        editorArea.querySelector('.line-container.active')?.scrollIntoView({ block: 'center' });
    });

    // [pestana, panel, display]. Una pestana nueva es una fila mas.
    const TABS = [
        [tabBasic, keyboardGrid, 'grid'],
        [tabGreek, greekGrid, 'grid']
    ];

    function activateTab(activeTab) {
        TABS.forEach(([tab, panel, display]) => {
            const on = tab === activeTab;
            tab.classList.toggle('text-blue-600', on);
            tab.classList.toggle('border-b-2', on);
            tab.classList.toggle('border-blue-600', on);
            tab.classList.toggle('text-gray-500', !on);
            panel.style.display = on ? display : 'none';
        });
    }

    TABS.forEach(([tab]) => tab.addEventListener('click', () => activateTab(tab)));

    let toastTimer = null;
    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.remove('opacity-0');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.add('opacity-0'), 2000);
    }

    // --- Inicio ---
    customElements.whenDefined('math-field').then(() => {
        if (!load()) createNewLine();
    });
});

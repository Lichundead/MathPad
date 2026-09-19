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

// Una tecla cambia de caja solo si es una letra. ',' y el espacio no, y si se
// les aplicara, la etiqueta «Espacio» se sobrescribiria con un espacio en blanco.
// Fuera del closure a proposito, para poder comprobarla.
function isCaseLetter(v) {
    return typeof v === 'string' && v.length === 1 && v.toLowerCase() !== v.toUpperCase();
}

// v1 guardaba un unico procedimiento suelto. Pura y fuera del closure a proposito:
// es la ruta donde se pierde el trabajo del estudiante si falla, y asi se comprueba.
function legacyToDocs(data) {
    if (!data || !Array.isArray(data.lines) || data.lines.length === 0) return [];
    return [newDoc('Procedimiento 1', data.lines, data.counter)];
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
    const qwertyGrid = document.getElementById('qwerty-grid');
    const tabBasic = document.getElementById('tab-basic');
    const tabQwerty = document.getElementById('tab-qwerty');
    const tabGreek = document.getElementById('tab-greek');
    const greekGrid = document.getElementById('greek-grid');
    const btnShift = document.getElementById('btn-shift');
    const btnRenderLine = document.getElementById('btn-render-line');
    const btnShare = document.getElementById('btn-share');
    const btnEvalIA = document.getElementById('btn-eval-ia');
    const studentCodeInput = document.getElementById('student-code');
    const captureStage = document.getElementById('capture-stage');
    const docSelect = document.getElementById('doc-select');
    const btnPdf = document.getElementById('btn-pdf');

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
                studentCode: studentCodeInput.value
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
            } else {
                migrateLegacy();
            }
        } catch (e) {
            console.warn('No se pudo cargar:', e);
        }

        if (docs.length === 0) docs = [newDoc('Procedimiento 1')];
        if (!currentDoc()) activeDocId = docs[0].id;

        const doc = currentDoc();
        linesData = doc.lines;
        lineCounter = doc.counter;
        renderDocSelect();
        return linesData.length > 0;
    }

    function renderDocSelect() {
        docSelect.innerHTML = '';
        docs.forEach(d => docSelect.add(new Option(d.name, d.id, false, d.id === activeDocId)));
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

    function switchDoc(id) {
        save();                      // vuelca el actual antes de soltarlo
        loadDoc(id);
        save();
    }

    docSelect.addEventListener('change', () => {
        if (docSelect.value !== 'new') {
            switchDoc(docs.find(d => String(d.id) === docSelect.value).id);
            return;
        }
        const name = (prompt('Nombre del procedimiento:') || '').trim();
        if (!name) {
            renderDocSelect();       // deshace la seleccion de «Nuevo…»
            return;
        }
        save();
        const doc = newDoc(name);
        docs.push(doc);
        activeDocId = doc.id;
        linesData = doc.lines;
        lineCounter = 1;
        activeLineId = null;
        renderDocSelect();
        createNewLine();
    });

    // --- Edición ---
    function createNewLine(type = 'math') {
        const id = lineCounter++;
        linesData.push({ id, rawText: '', type });
        activeLineId = id;
        renderEditor();
        save();
    }

    function renderEditor() {
        editorArea.innerHTML = '';
        activeInputForKeyboard = null;

        linesData.forEach((lineObj, index) => {
            const lineEl = document.createElement('div');
            lineEl.className = 'line-container' + (lineObj.id === activeLineId ? ' active' : '');

            const numEl = document.createElement('div');
            numEl.className = 'line-number';
            numEl.textContent = index + '.';

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
                // Evita que Android abra su propio teclado encima del nuestro
                input.setAttribute('inputmode', 'none');
                input.setAttribute('autocomplete', 'off');
                input.setAttribute('autocorrect', 'off');
                input.setAttribute('autocapitalize', 'off');
                input.spellcheck = false;

                if (lineObj.id === activeLineId) {
                    input.classList.add('border', 'border-gray-300', 'rounded', 'bg-gray-50');
                    activeInputForKeyboard = input;
                    input.addEventListener('input', (e) => {
                        lineObj.rawText = e.target.value;
                        save();
                    });
                    setTimeout(() => input.focus(), 50);
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

            lineEl.appendChild(numEl);
            lineEl.appendChild(contentEl);

            // --- Borrar línea ---
            const actionEl = document.createElement('div');
            actionEl.className = 'px-2 flex items-center justify-center';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'text-gray-300 active:text-red-500 w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none';
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

        editorArea.scrollTop = editorArea.scrollHeight;
    }

    // Salir del modo edicion. Devuelve si habia algo que cerrar (lo usa el boton atras).
    function deactivate() {
        if (activeLineId === null) return false;
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
                    promptText += `[Línea ${index}] (Texto): ${line.rawText}\n`;
                } else {
                    promptText += `[Línea ${index}] (Ecuación): $$ ${line.rawText} $$\n`;
                }
            }
        });

        return promptText;
    }

    async function copyToClipboard(text) {
        // API moderna (funciona en el WebView de Capacitor, que sirve por https://localhost)
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (e) {
                /* cae al método antiguo */
            }
        }

        // Fallback: textarea fuera de pantalla + execCommand
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (err) {
            console.error('Error al copiar:', err);
        } finally {
            document.body.removeChild(textArea);
        }
        return ok;
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

    // --- Compartir como imagen ---
    // html2canvas NO ve dentro del Shadow DOM de MathLive, así que reconstruimos
    // el procedimiento con KaTeX (DOM normal) en un lienzo oculto y capturamos eso.
    function buildCaptureStage() {
        captureStage.innerHTML = '';
        linesData.forEach((lineObj, index) => {
            if (!lineObj.rawText || !lineObj.rawText.trim()) return;

            const row = document.createElement('div');
            row.className = 'capture-line';

            const num = document.createElement('div');
            num.className = 'capture-num';
            num.textContent = index + '.';

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

            row.appendChild(num);
            row.appendChild(body);
            captureStage.appendChild(row);
        });
    }

    async function shareBlob(blob, ext) {
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
            const fileName = `mathpad_${Date.now()}.${ext}`;
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
        const file = new File([blob], `mathpad_procedimiento.${ext}`, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: 'Mi Procedimiento Matemático', files: [file] });
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mathpad_procedimiento.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(ext === 'pdf' ? 'PDF descargado' : 'Imagen descargada');
    }

    async function renderCanvas() {
        buildCaptureStage();
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
                    await shareBlob(blob, 'png');
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
            const canvas = await renderCanvas();
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

            await shareBlob(pdf.output('blob'), 'pdf');
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

    // Mayusculas: reescribe data-insert y la etiqueta de las teclas de letra.
    // Se salta ',' y el espacio, que no cambian de caja.
    let shift = false;

    function setShift(on) {
        shift = on;
        btnShift.classList.toggle('bg-blue-100', on);
        btnShift.classList.toggle('text-blue-700', on);
        qwertyGrid.querySelectorAll('.math-key[data-insert]').forEach(k => {
            const v = k.dataset.insert;
            if (!isCaseLetter(v)) return;
            k.dataset.insert = on ? v.toUpperCase() : v.toLowerCase();
            k.textContent = k.dataset.insert;
        });
    }

    bindKey(btnShift, () => setShift(!shift));

    document.querySelectorAll('.math-key[data-insert]').forEach(btn => {
        bindKey(btn, () => {
            const { insert, text } = btn.dataset;
            if (shift) setShift(false);   // un solo uso, como en cualquier teclado de movil
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

    const btnToggleKeyboard = document.getElementById('btn-toggle-keyboard');
    let keyboardVisible = true;
    btnToggleKeyboard.addEventListener('click', () => {
        const keyboardContainer = document.getElementById('keyboard-container');
        keyboardContainer.style.display = keyboardVisible ? 'none' : 'block';
        btnToggleKeyboard.innerHTML = keyboardVisible
            ? '<i class="fa-solid fa-chevron-up"></i>'
            : '<i class="fa-solid fa-chevron-down"></i>';
        keyboardVisible = !keyboardVisible;
    });

    // [pestana, panel, display]. Una pestana nueva es una fila mas.
    const TABS = [
        [tabBasic, keyboardGrid, 'grid'],
        [tabQwerty, qwertyGrid, 'flex'],
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
        if (load()) {
            activeLineId = null;
            renderEditor();
        } else {
            createNewLine();
        }
    });
});

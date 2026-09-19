/* MathPad — lógica principal (sin dependencias de red) */

const STORAGE_KEY = 'mathpad:lines:v1';

// --- Configuración de MathLive para funcionar 100% offline ---
if (window.MathfieldElement) {
    MathfieldElement.fontsDirectory = 'vendor/mathlive/fonts';
    MathfieldElement.soundsDirectory = null;      // no empaquetamos sonidos
    MathfieldElement.mathVirtualKeyboardPolicy = 'manual'; // usamos NUESTRO teclado
}

document.addEventListener('DOMContentLoaded', () => {

    // --- Estado ---
    let linesData = [];
    let activeLineId = null;
    let lineCounter = 1;
    let activeInputForKeyboard = null;

    // --- DOM ---
    const editorArea = document.getElementById('editor-area');
    const btnNewLine = document.getElementById('btn-new-line');
    const btnClear = document.getElementById('btn-clear');
    const keyboardGrid = document.getElementById('keyboard-grid');
    const qwertyGrid = document.getElementById('qwerty-grid');
    const tabBasic = document.getElementById('tab-basic');
    const tabQwerty = document.getElementById('tab-qwerty');
    const btnRenderLine = document.getElementById('btn-render-line');
    const btnShare = document.getElementById('btn-share');
    const btnEvalIA = document.getElementById('btn-eval-ia');
    const studentCodeInput = document.getElementById('student-code');
    const captureStage = document.getElementById('capture-stage');

    // --- Persistencia ---
    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                lines: linesData,
                counter: lineCounter,
                studentCode: studentCodeInput.value
            }));
        } catch (e) {
            console.warn('No se pudo guardar:', e);
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (!data) return false;
            if (data.studentCode) studentCodeInput.value = data.studentCode;
            if (!Array.isArray(data.lines) || data.lines.length === 0) return false;
            linesData = data.lines;
            lineCounter = data.counter || (linesData.length + 1);
            return true;
        } catch (e) {
            return false;
        }
    }

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

    // --- Evaluar: copiar el procedimiento como texto plano para una IA ---

    function buildPromptText() {
        const studentCode = studentCodeInput.value.trim();
        let promptText = '';
        let hasContent = false;

        if (studentCode !== '') {
            promptText += `Estudiante: ${studentCode}\n\n`;
        }

        linesData.forEach((line, index) => {
            if (line.rawText && line.rawText.trim() !== '') {
                hasContent = true;
                if (line.type === 'text') {
                    promptText += `[Línea ${index}] (Texto): ${line.rawText}\n`;
                } else {
                    promptText += `[Línea ${index}] (Ecuación): $$ ${line.rawText} $$\n`;
                }
            }
        });

        return { promptText, hasContent };
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
        if (activeLineId !== null) {
            activeLineId = null;
            renderEditor();
        }

        const { promptText, hasContent } = buildPromptText();
        if (!hasContent) {
            showToast('No hay contenido para evaluar');
            return;
        }

        const ok = await copyToClipboard(promptText);
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

    async function shareBlob(blob) {
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
            const fileName = `mathpad_${Date.now()}.png`;
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
        const file = new File([blob], 'mathpad_procedimiento.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: 'Mi Procedimiento Matemático', files: [file] });
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mathpad_procedimiento.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Imagen descargada');
    }

    btnShare.addEventListener('click', async () => {
        if (activeLineId !== null) {
            activeLineId = null;
            renderEditor();
        }

        const hasContent = linesData.some(l => l.rawText && l.rawText.trim() !== '');
        if (!hasContent) {
            showToast('No hay contenido para compartir');
            return;
        }

        showToast('Generando imagen...');
        try {
            buildCaptureStage();
            await new Promise(r => setTimeout(r, 250)); // deja que KaTeX pinte

            const canvas = await html2canvas(captureStage, {
                backgroundColor: '#ffffff',
                scale: 2,
                logging: false
            });

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    showToast('Error al generar imagen');
                    return;
                }
                try {
                    await shareBlob(blob);
                } catch (err) {
                    console.log('Compartir cancelado o falló:', err);
                }
            }, 'image/png');

        } catch (error) {
            console.error('Error html2canvas:', error);
            showToast('Error al procesar la imagen');
        }
    });

    // --- Teclado matemático ---
    function insertTextAtCursor(textToInsert) {
        if (!activeInputForKeyboard) return;

        if (activeInputForKeyboard.tagName && activeInputForKeyboard.tagName.toLowerCase() === 'input') {
            let txt = textToInsert;
            if (txt === '\\cdot') txt = '×';
            if (txt === '\\div') txt = '÷';
            if (txt.includes('\\frac')) txt = '/';
            if (txt.includes('\\begin{cases}')) txt = '{';

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

    document.querySelectorAll('.math-key[data-insert]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (activeLineId === null) {
                createNewLine('math');
                setTimeout(() => insertTextAtCursor(btn.dataset.insert), 80);
                return;
            }
            insertTextAtCursor(btn.dataset.insert);
        });
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    });

    document.querySelectorAll('.btn-backspace').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
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
        });
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    });

    // --- UI general ---
    btnNewLine.addEventListener('click', () => createNewLine('math'));
    document.getElementById('btn-new-text').addEventListener('click', () => createNewLine('text'));

    btnRenderLine.addEventListener('click', () => {
        if (activeLineId !== null) {
            activeLineId = null;
            renderEditor();
        }
    });

    btnClear.addEventListener('click', () => {
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

    function activateTab(tabName) {
        if (tabName === 'basic') {
            tabBasic.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            tabBasic.classList.remove('text-gray-500');
            tabQwerty.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            tabQwerty.classList.add('text-gray-500');
            keyboardGrid.style.display = 'grid';
            qwertyGrid.style.display = 'none';
        } else {
            tabQwerty.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            tabQwerty.classList.remove('text-gray-500');
            tabBasic.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            tabBasic.classList.add('text-gray-500');
            qwertyGrid.style.display = 'flex';
            keyboardGrid.style.display = 'none';
        }
    }

    tabBasic.addEventListener('click', () => activateTab('basic'));
    tabQwerty.addEventListener('click', () => activateTab('qwerty'));

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
        if (window.mathVirtualKeyboard) {
            window.mathVirtualKeyboard.mathVirtualKeyboardPolicy = 'manual';
        }
        if (load()) {
            activeLineId = null;
            renderEditor();
        } else {
            createNewLine();
        }
    });
});

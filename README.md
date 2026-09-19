# MathPad — Android (Capacitor)

Editor de procedimientos matemáticos, empaquetado como app Android nativa.
**Funciona 100% sin internet**: MathLive, KaTeX, html2canvas, Font Awesome y
Tailwind están compilados/vendorizados dentro de `www/vendor` y `www/css`.

---

## Requisitos

- Node 18+ (probado con Node 22)
- Android Studio (incluye el SDK y el JDK que Gradle necesita)
- Variable `ANDROID_HOME` apuntando al SDK (Android Studio la configura sola)

## Puesta en marcha

```bash
npm install          # el proyecto viene sin node_modules
npm run build:css    # compila Tailwind -> www/css/styles.css
npm run serve        # opcional: probar en el navegador -> http://localhost:5173
```

> Ábrelo con un servidor, no con `file://`: las fuentes de MathLive y KaTeX
> se bloquean por CORS al abrir el HTML directamente desde el disco.

## Generar la app

```bash
npm run android      # compila CSS, sincroniza y abre Android Studio
```

En Android Studio: **Run ▶** con el teléfono conectado (depuración USB activada).

Para un APK de debug sin abrir el IDE:

```bash
npm run apk
# resultado: android/app/build/outputs/apk/debug/app-debug.apk
```

Ese APK lo puedes pasar al teléfono e instalarlo activando "orígenes desconocidos".

## Si cambias algo en `www/`

Siempre `npm run sync` antes de volver a compilar: Capacitor copia `www/`
dentro de `android/app/src/main/assets/public`. Si editas y compilas sin
sincronizar, verás la versión vieja.

## APK firmado (para distribuir o subir a Play Store)

```bash
keytool -genkey -v -keystore mathpad.keystore -alias mathpad \
  -keyalg RSA -keysize 2048 -validity 10000
```

Luego en Android Studio: **Build → Generate Signed Bundle / APK**.
Guarda el keystore y su contraseña: sin ese archivo no puedes publicar
actualizaciones de la misma app nunca más.

---

## Qué cambió respecto al HTML original

| Problema | Solución |
|---|---|
| Librerías por CDN (app inservible sin datos) | Todo vendorizado en `www/vendor`; Tailwind compilado con su CLI |
| `height: calc(100vh - 250px)` peleaba con el flex y con el teclado del sistema | El layout ahora es `100dvh` + `flex-1 min-h-0`; el teclado dejó de ser `position: fixed` |
| Android abría su teclado nativo sobre el teclado propio en las líneas de texto | `inputmode="none"` en esos inputs |
| html2canvas no ve el Shadow DOM de MathLive → fórmulas en blanco en la imagen | La imagen se genera desde un lienzo oculto (`#capture-stage`) donde el LaTeX se pinta con KaTeX |
| `navigator.share` no siempre existe dentro del WebView | Ruta nativa con `@capacitor/filesystem` + `@capacitor/share`, con fallback web |
| Al cerrar la app se perdía todo | Autoguardado en `localStorage` |
| Notch / barra de navegación tapando la UI | `env(safe-area-inset-*)` en header y barra de acciones |
| MathLive intentaba descargar fuentes y sonidos | `fontsDirectory` local y `soundsDirectory = null` |

## Estructura

```
www/
  index.html          # sin una sola etiqueta <script src="https://...">
  css/input.css       # fuente Tailwind + estilos propios
  css/styles.css      # generado, no lo edites a mano
  js/app.js           # toda la lógica
  vendor/             # mathlive, katex, html2canvas, fontawesome
android/              # proyecto nativo (generado por Capacitor)
capacitor.config.json # appId: com.sebas.mathpad
```

## Ideas para después

- Icono propio: Android Studio → `res` → clic derecho → *Image Asset*
- Botón atrás de Android para salir del modo edición (`@capacitor/app`)
- Exportar a PDF además de PNG
- Guardar varios procedimientos con nombre, no solo el último

---

## Compilar sin Android Studio (GitHub Actions)

1. Sube el proyecto a un repo de GitHub (`android/` incluido, `node_modules/` no).
2. Pestaña **Actions** → workflow *Build APK* → **Run workflow**.
   También corre solo con cada push a `main`.
3. Cuando termine (~4-6 min), entra al run y descarga el artefacto
   `mathpad-debug-apk`. Viene en .zip; dentro está `app-debug.apk`.
4. Pásalo al teléfono e instálalo permitiendo "instalar apps desconocidas"
   para la app desde la que lo abras (archivos, Drive, etc.).

El workflow está en `.github/workflows/android.yml`.

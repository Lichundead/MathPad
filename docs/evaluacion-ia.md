# Evaluación con IA — diseño

Estado: propuesta, sin implementar. Fecha: 2026-09-19.

Hoy el botón «Evaluar» arma el procedimiento en LaTeX con `buildPromptText()` y lo
copia al portapapeles. El objetivo es que la app lo mande a un modelo y muestre la
retroalimentación dentro de la app.

## Restricción que manda sobre todo lo demás

Una clave de API dentro del APK es extraíble con `apktool` en dos minutos. No hay
ofuscación que lo arregle: si el cliente puede usar la clave, el atacante también.
Por eso hay backend. Todo el resto del diseño sale de esa única restricción.

Segunda restricción, del proyecto: **la app funciona sin conexión**. La evaluación es
la única función que necesita red, y su ausencia no puede degradar nada más.

---

## 1. Endpoints y contrato

Dos endpoints. No más.

### `POST /v1/enroll`

Se llama una vez, la primera vez que el estudiante pulsa «Evaluar».

```jsonc
// petición
{ "student_code": "A1B2C3" }

// 200
{ "token": "<opaco, 32 bytes base64url>", "student_code": "A1B2C3" }

// 403  código fuera de la lista del curso
{ "error": "unknown_student_code" }
```

### `POST /v1/evaluations`

```jsonc
// cabecera
Authorization: Bearer <token>

// petición
{
  "lines": [
    { "index": 0, "type": "text", "content": "Resolver 2x + 4 = 10" },
    { "index": 1, "type": "math", "content": "2x + 4 = 10" },
    { "index": 2, "type": "math", "content": "x = 3" }
  ],
  "client_request_id": "uuid-v4 generado en el cliente"
}

// 200
{
  "evaluation_id": "uuid",
  "verdict": "incorrect",          // correct | incorrect | incomplete
  "feedback_md": "En la línea 2...", // markdown, se muestra tal cual
  "line_notes": [                   // opcional, para resaltar líneas
    { "index": 2, "status": "error", "note": "Revisa la división" }
  ]
}

// 429  { "error": "rate_limited", "retry_after_s": 45 }
// 503  { "error": "model_unavailable" }
```

**Por qué `lines` estructurado y no el string de `buildPromptText()`.** El cliente no
debe decidir el formato del prompt. Si mandas texto ya armado, cada cambio de prompt
exige publicar un APK nuevo; con datos estructurados el prompt vive en el servidor y
se itera sin tocar la app. `buildPromptText()` se queda igual para el botón de copiar.

**Por qué `client_request_id`.** Idempotencia. En móvil la red se cae a mitad de la
petición todo el tiempo; sin esto, cada reintento del estudiante es otra llamada
pagada al modelo. El servidor guarda el id y devuelve la respuesta ya calculada.

**Por qué síncrono y no una cola con *polling*.** Una evaluación tarda 3–10 s, que
cabe de sobra en un timeout HTTP. Una cola con `GET /evaluations/{id}` añade estado,
*polling* y reintentos en el cliente a cambio de nada.
`ponytail: síncrono; pasar a cola + webhook si el p95 supera ~25 s o el WebView corta antes.`

---

## 2. Autenticación

El punto de partida honesto: **cualquier cosa que el APK pueda hacer, un script lo
puede hacer también.** El objetivo no es «imposible de abusar», es «abusar cuesta más
de lo que vale». Tres niveles, de menor a mayor esfuerzo:

| Nivel | Qué es | Coste | Qué detiene |
|---|---|---|---|
| A | Token de dispositivo anónimo | ~0 | Nada. Cualquiera acuña tokens infinitos. |
| B | **Token ligado al código de estudiante** | bajo | Hay que conocer un código válido del curso. |
| C | Play Integrity API | alto | Exige un APK legítimo en un Android real. |

**Recomendación: B ahora, C sólo si aparece abuso real.**

B es la opción perezosa correcta porque **el campo de código de estudiante ya existe
en la interfaz** (`#student-code`, ya persistido en `localStorage`). No hay que
inventar identidad: el profesor carga la lista del curso, un código desconocido recibe
403, y el token que entrega `/enroll` queda atado a ese código. Abusar exige robar un
código de un compañero, lo cual es rastreable y tiene consecuencias fuera del
software. Eso basta para un aula.

Tres controles encima, todos baratos:

- **Límite por código**: N evaluaciones/hora y M/día, contador en Postgres.
  `ponytail: contador en la propia tabla con SELECT ... FOR UPDATE; mover a Redis si el tráfico obliga.`
- **Tope de tamaño**: rechazar >40 líneas o >4 KB antes de llamar al modelo. Es el
  control que de verdad acota la factura.
- **Presupuesto global**: un tope de gasto diario en el servidor; superado, 503. Es el
  freno de mano cuando todo lo demás falla.

Los tokens no caducan solos: se revocan por código desde la tabla del roster. Un
`revoked_at` es más simple que la rotación de refresh tokens y cubre el caso real
(«este código está abusando, córtalo»).

**Lo que NO hace falta:** OAuth, cuentas con contraseña, JWT firmados. Un token opaco
aleatorio contra una tabla es menos código, no tiene fecha de caducidad que gestionar
y se revoca de verdad.

---

## 3. Base de datos

Cuatro tablas.

```
roster          (student_code PK, course_id, created_at, revoked_at NULL)
device_tokens   (token_hash PK, student_code FK, created_at, last_seen_at)
evaluations     (id PK, student_code FK, client_request_id UNIQUE,
                 lines_json, verdict, feedback_md,
                 model, prompt_tokens, completion_tokens, cost_cents,
                 created_at, latency_ms)
usage_counters  (student_code, window_start, count)   -- límite de uso
```

**Se guarda** el procedimiento y la respuesta: es lo que permite al profesor revisar
el trabajo, y es la prueba forense si hay que investigar un abuso. Los tokens y el
coste por llamada se guardan porque sin eso no sabes qué te está costando el servicio.

**No se guarda**: la clave de API (variable de entorno o gestor de secretos, nunca en
la base ni en el repositorio), el token en claro (sólo `sha256`, igual que una
contraseña: una filtración de la base no da acceso), ni identificadores de dispositivo,
IP a largo plazo, ni nada que identifique a un menor más allá del código del curso.
Ese mínimo es deliberado: son datos de estudiantes, probablemente menores de edad.

Retención: purgar `evaluations` al cerrar el curso. Un `DELETE` por `course_id`.

---

## 4. Comportamiento sin conexión

Regla: **la red sólo puede afectar al botón «Evaluar»**. Nada en el arranque, ningún
recurso remoto, ningún `fetch` en la ruta de carga. Eso ya se cumple hoy y el diseño
no lo toca.

Sin conexión, «Evaluar» hace lo que hace hoy: copiar al portapapeles, con un aviso de
que no hay red y el texto queda copiado para pegarlo a mano. El camino viejo no se
borra, pasa a ser el modo degradado. Es la opción perezosa y además la más robusta:
el estudiante nunca se queda sin salida.

**No se encola para enviar luego.** Una cola de reintentos diferidos necesita
almacenamiento, política de caducidad y resolución de conflictos, y la
retroalimentación tardía no sirve para nada: el estudiante ya cerró la app. Si más
tarde resulta que sí hace falta, se añade con un botón explícito de reintentar.

---

## 5. Cambios en el cliente

Pequeños y contenidos. `app.js` no se reescribe.

**Dónde entra el `fetch`.** El manejador de `btnEvalIA` ya llama a `buildPromptText()`
y decide qué hacer. Ahí se bifurca:

```
btnEvalIA click
  ├─ sin contenido      → toast, salir                    (ya existe)
  ├─ navigator.onLine=false → copiar al portapapeles + toast «sin conexión» (ruta actual)
  └─ con red            → POST /v1/evaluations → panel de resultado
```

`navigator.onLine` sólo detecta «no hay interfaz de red»; una red que existe pero no
llega a ningún sitio se detecta con el `catch` del `fetch`, que cae a la misma ruta de
portapapeles. Los dos caminos terminan en el mismo sitio, así que no hay lógica
duplicada.

**Nuevo estado en la interfaz.** Un panel deslizante sobre el editor, no una página
nueva:

- *Esperando*: panel abierto con un indicador y el botón deshabilitado. Cancelable con
  `AbortSignal.timeout(30000)`, para que un cuelgue no deje la interfaz bloqueada.
- *Respuesta*: `feedback_md` renderizado. Markdown mínimo a mano (negritas, listas,
  saltos) — no entra una dependencia nueva para esto. Las fórmulas dentro de la
  respuesta se pintan con KaTeX, **que ya está cargado**.
- *Error*: el mensaje concreto y el botón «copiar para pegar en un chat», que es la
  salida que el estudiante ya conoce. Nunca un callejón sin salida.

**Almacenamiento nuevo en el cliente**: el token, en `localStorage`, junto a la clave
que ya existe.

---

## 6. Migración por etapas

Cada etapa deja la app funcionando y es útil por sí sola.

**Etapa 0 — backend a solas.** FastAPI con los dos endpoints, roster cargado a mano,
desplegado y probado con `curl`. La app no se toca. Se valida el prompt y se mide
cuánto cuesta una evaluación de verdad antes de comprometerse.

**Etapa 1 — cliente detrás de una bandera.** El `fetch` entra, pero la ruta nueva sólo
se activa si hay una URL de backend configurada. Sin ella, la app se comporta
exactamente como hoy. Un APK, los dos comportamientos, y volver atrás es cambiar una
constante.

**Etapa 2 — piloto.** Un curso. Se vigilan coste por evaluación, latencia p95 y tasa
de error. Aquí es donde se descubre si el límite de uso está bien calibrado; en el
escritorio no se descubre.

**Etapa 3 — general.** Se ajustan los límites con datos reales y se activa para todos.
El botón de copiar al portapapeles **se queda para siempre** como modo sin conexión.

Play Integrity (nivel C) queda fuera de todas las etapas. Se añade si el gasto muestra
abuso real, no antes.

---

## Resumen de decisiones

| Decisión | Razón |
|---|---|
| Backend intermediario | La clave no puede vivir en un APK. |
| Dos endpoints, síncronos | Una evaluación cabe en una petición HTTP. |
| `lines` estructurado, no prompt armado | Iterar el prompt sin publicar un APK. |
| `client_request_id` | Que un reintento no sea otra llamada pagada. |
| Identidad = código de estudiante | El campo ya existe en la interfaz. |
| Token opaco, no JWT | Menos código y revocación de verdad. |
| Límites por código + tope de gasto | Acota la factura, que es el riesgo real. |
| Hash del token en la base | Una filtración no da acceso. |
| Sin cola de envío diferido | La retroalimentación tardía no sirve. |
| Portapapeles como modo degradado | El estudiante nunca se queda sin salida. |

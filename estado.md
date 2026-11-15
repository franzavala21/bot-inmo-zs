# Estado del proyecto

**Fase actual:** 3. WhatsApp conectado por la API oficial de Meta con un **número nuevo** (+54 9 351 772-5778), probado en ambos sentidos el 2026-11-12. Bot APAGADO.

## Hecho
- **Fase 0:** monorepo (pnpm), `CLAUDE.md`, `docs/especificacion.md` (F-01 a F-17), `.env.example` y `.gitignore`.
- **Fase 1, cerrada el 2026-11-03:** F-01 a F-04 verificadas en producción.
  - Producción: https://bot-inmo-zs-vl7l.vercel.app (Vercel plan Hobby). Repo: github.com/franzavala21/bot-inmo-zs (privado, rama `main`).
  - Login real en producción confirmado (`last_sign_in_at` 2026-11-03T23:43Z). El cron da 401 sin secreto y 200 con secreto.
  - Supabase: proyecto `cqsk…`, migración `0001` aplicada y email por SMTP propio (Resend).
  - Tokko: 71 propiedades (67 en venta y 4 en alquiler). Tipos: 39 casas, 26 terrenos, 3 departamentos, 2 PH y 1 oficina.

## Decisiones y aprendizajes de la Fase 1
- **Ocupadas:** los dueños las pasan a "no disponible" en Tokko. El sync solo toma `status === 2` y desactiva lo que deja de venir. No hay detección por tags.
- **Superficie:** `surface_total` usa `surface` (el lote), porque Tokko deja `total_surface` en 0 en casi todos los terrenos. `bedrooms` sale de `suite_amount`, que es lo que Tokko llama dormitorios.
- **Expensas:** cargadas en solo 2 de 71 propiedades. Si un cliente pregunta y el dato no está, el bot deriva a una persona.
- **Cron:** diario (`0 11 * * *`, 8:00 de Argentina) porque Hobby no permite más seguido. Entre corridas se usa el botón "Sincronizar". Si pasan a Pro, se vuelve a `*/30`.
- **Migración 0001:** `unaccent` no es inmutable (error 42P17 en la columna generada). Se agregó el envoltorio `immutable_unaccent` y las extensiones van en el esquema `extensions`.
- **Auth:** el login usa `shouldCreateUser: false`, así que cada dueño tiene que existir en Supabase Auth, además de estar en `allowed_users` y en `ALLOWED_EMAILS`.
- **Email:** el email que trae Supabase manda unos 2 por hora y se agota enseguida. Se usa Resend por SMTP con usuario `resend` y la API key como contraseña.
- **.gitignore:** una regla `auth/` ignoraba `/auth/callback` y en producción daba 404. Ahora se limita a `apps/wa-worker/auth/`. Al agregar rutas nuevas, revisar con `git status --ignored`.
- **Local:** la web lee el `.env` de la raíz mediante el symlink `apps/web/.env`. Corre en el puerto 3001 porque el 3000 está ocupado por otro proyecto.

## Fase 2: avance (2026-11-04)
- Hecho: `apps/wa-worker` (Baileys, solo transporte), `/api/inbound` firmado con HMAC, migración `0002` (aplicada), bandeja en tiempo real, interruptor IA/humano y `/conexion` con el QR.
- Prueba de punta a punta con `WA_TRANSPORT=fake`: `apps/wa-worker/scripts/e2e.mts` (13 chequeos, todos OK). Correr con la web en `localhost:3001` y el worker en modo fake:
  `cd apps/wa-worker && node_modules/.bin/tsx --env-file=../../.env scripts/e2e.mts`
- Contacto de prueba: teléfono `5490000000001`, `is_test=true`. No borrarlo sin pedirlo.
- Aprendizaje: `node_modules/.bin/tsx` es un script de `sh` y no pasa bien el SIGTERM. El worker se arranca con `node --import tsx src/index.ts` (un solo proceso), así se apaga ordenado y deja el canal "offline". Verificado en Docker.

### Cierre de la Fase 2 (2026-11-05)
- Worker en Railway (config `apps/wa-worker/railway.json`, volumen `/data`, `AUTH_DIR=/data/auth`). Chip vinculado (termina en 5304). `INBOUND_HMAC_SECRET` cargado en Vercel y en Railway.
- Prueba real OK: mensaje entrante, respuesta desde el panel (enviada, sin duplicar el eco), respuesta desde el teléfono del chip (`outbound_phone`) y audio guardado y descargable.
- Diagnóstico sin datos personales: `cd apps/wa-worker && node_modules/.bin/tsx --env-file=../../.env scripts/check-real.mts` (conversaciones de la última hora: tipos, estados y audit, sin teléfonos ni textos).

## Pendientes sueltos
- [ ] Hermano: crearlo en Auth y cargarlo en `allowed_users`, en `ALLOWED_EMAILS` (local y Vercel) y en Redirect URLs si va a usar local.
- [ ] Borrar el proyecto duplicado `bot-inmo-zs` en Vercel, si todavía existe.

## Fase 3: avance (2026-11-05)
- Código en `packages/core/src/bot/`: `orchestrator.ts` (código: camino, búsqueda con ampliación, reintento, derivación), `agents.ts` (clasificador, redactor y verificador con zod), `numeric.ts` (control numérico y de links), `run-turn.ts` (frenos de gasto y por hora, transcripción, `bot_commit`), `transcribe.ts`, `llm.ts` (OpenAI + precios para el tope).
- Migración `0003_bot.sql` (SIN aplicar): `channels.bot_enabled` (arranca apagado), `business_info`, `claim_bot_turn`, `bot_commit` (traza + envío + derivación en una transacción), `set_bot_enabled`.
- `/api/inbound` corre el turno con `after()` tras 7 s de espera (se juntan mensajes seguidos). `maxDuration = 60`.
- Panel: interruptor del bot en `/conexion`, `/negocio` (info del negocio editable) y bitácora plegable en cada chat.
- Worker: nunca envía por WhatsApp real a contactos `is_test` (los marca como fallidos).
- Prueba sin escribir en la base: `cd packages/core && node_modules/.bin/tsx --env-file=../../.env scripts/bot-try.ts [caso]`.
- Ajustes tras probar con el modelo real (2026-11-05):
  - El redactor marcaba "necesita persona" al ofrecer el contacto: ahora solo con dato faltante, visita/negociación o tema delicado.
  - Verificador: devuelve solo violaciones `{rule, quote}`; el código descarta citas que no están en la respuesta (citaba al cliente) y aprueba si no queda ninguna.
  - Control en código: si la respuesta dice que sigue "una persona del equipo" o "no tengo información", se deriva aunque el redactor no lo marque.
  - Reglas nuevas: no prometer escribir después (mensajes proactivos), no afirmar cercanía entre zonas, no dar calles.
- Decisión: proveedor OpenAI (gpt-4.1-mini + gpt-4o-mini-transcribe). Se evaluó Anthropic: Claude no transcribe audio; el cambio queda fácil por la interfaz `Llm`.
- Decisión: la moneda de las expensas no viene de Tokko; el bot muestra el número con "(moneda sin dato)" y, si preguntan, deriva.

### Falta para cerrar la Fase 3
- [x] Aplicar `0003_bot.sql`.
- [x] `OPENAI_API_KEY` en `.env` local.
- [x] Variables de OpenAI en Vercel (el turno real corrió en producción). Límite de gasto en la cuenta de OpenAI: confirmar.
- [x] `bot-try.ts`: 13 casos OK (USD ~0,018 la corrida completa, ~USD 0,001–0,004 por respuesta).
- [x] `/negocio` cargado (falta `requisitos_compra`, que queda vacío: si preguntan, deriva).
- [x] Prueba real 2026-11-08: 2 mensajes y 2 respuestas enviadas, bitácora completa, costo USD 0,005. Después apagaron el bot.
- [x] Prueba real 2026-11-09: 2 audios transcriptos y respondidos; pedido de visita derivado con la frase fija.

### Incidente: chip bloqueado (2026-11-09)
- 14:41 prendieron el bot; 14:42 y 14:45 el bot mandó 2 respuestas (a un teléfono de los dueños). 14:46:49 el worker quedó `offline` pidiendo QR: la sesión se cerró desde WhatsApp (el worker archiva la sesión y pide QR nuevo; no se borró nada).
- El usuario reporta el número bloqueado. Causa exacta: sin log de WhatsApp que la diga (hipótesis: chip nuevo + cliente no oficial).
- `channels.bot_enabled` quedó en true: apagarlo desde `/conexion`.
- No reescanear el QR con ese chip hasta resolver la revisión; nunca usar el número principal.

### Alquileres en el canal de ventas (2026-11-09)
- Decisión de los dueños: los alquileres los atiende otra persona. Si el cliente pide alquiler o consulta un código en alquiler, el bot deriva con frase fija, sin buscar ni redactar. La búsqueda usa siempre la operación del canal.

### Ajuste tras la prueba real (2026-11-08)
- El verificador rechazaba "El precio es ARS 550.000" de un alquiler porque no decía si era mensual. Tokko no trae el período. Se reprodujo 3 de 3.
  - Ahora los números los controla el código; el verificador solo marca un número si DATOS dice otro valor para el mismo dato.
  - El redactor no menciona campos "sin dato" (ej. mascotas) ni agrega aclaraciones que DATOS no tiene.
  - Una "dirección exacta" sin número ni palabra de calle (un barrio) se descarta en código (`looksLikeAddress`).
  - Repetido 6 veces: 5 respuestas y 1 derivación por el control de código (ofreció "alguien del equipo"). Los 13 casos de `bot-try` siguen OK.

## Paso a la API oficial de Meta (2026-11-10)
- Decisión de los dueños: API oficial, **número principal en coexistencia** (sigue en la app WhatsApp Business del teléfono), **todo en Vercel** (Railway se apaga; no borrar el volumen).
- Requisito de Meta: la coexistencia solo la activan Tech Providers o Solution Partners (Embedded Signup), con WhatsApp Business ≥ 2.24.17.
  - Camino: desarrollar con el número de prueba de Meta y decidir después si ser Tech Provider propio (verificación del negocio y revisión de la app) o ir por un Solution Partner.
  - Tras el alta hay 24 h para pedir la sincronización de contactos e historial (una sola vez).
  - En coexistencia la app pierde: listas de difusión, mensajes temporales y "ver una vez", ubicación en tiempo real y llamadas; también las herramientas de empresa y el perfil.
- Código:
  - `packages/core/src/transport/meta.ts`: firma `X-Hub-Signature-256`, lectura del webhook (mensajes, ecos `smb_message_echoes`, estados fallidos) y `MetaClient` (enviar, bajar archivos, estado del número). Graph `v26.0` (configurable).
  - `meta-dispatch.ts`: guarda en `ingest_inbound` y envía la cola desde la web, con ventana de 24 h, `is_test` y errores permanentes sin reintento.
  - `/api/whatsapp/meta`: verificación GET y POST firmado. Guarda antes de responder (si falla, Meta reintenta) y después corre el bot y envía.
  - Panel: el envío sale en el momento y avisa si no salió; botón "Reintentar"; pasadas 24 h se bloquea el envío con explicación; `/conexion` consulta a Meta el estado y la calidad del número.
  - Worker: si el canal es `meta`, no se conecta ni toma envíos.
- Migración `0004_meta.sql` (SIN aplicar): `channels.meta_phone_number_id`, `outbound_messages.claimed_at`, `fail_stale_sending`, `mark_delivery_failed`, `retry_outbound`.
- Tests: 52 en core (14 nuevos de Meta).

### Conexión con Meta (2026-11-12)
- Número nuevo, no el principal: +54 9 351 772-5778, `phone_number_id` 1426968407167616, WABA 1859520905073768, app 3186797974853138 ("Bot Mensajes Inmobiliaria"). Usuario del sistema "Zavala Agente".
- Webhook de la app → `/api/whatsapp/meta`, campo `messages`. La app está suscripta a la WABA (`subscribed_apps`): faltaba eso y por eso Meta no avisaba.
- Vercel: `META_ACCESS_TOKEN` (usuario del sistema, sin vencimiento, 21:13), `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`. Hay que actualizarlas con `vercel env update` (`rm` pide confirmación).
- Claves expuestas en capturas y en el chat: token viejo revocado (verificado `is_valid: false`); App Secret restablecido.
- Prueba 2026-11-12: "Hola" entrante guardado (`[meta] ok conv=aa3322a7… dup=false`) y respuesta de prueba enviada por la cola (`status: sent`, audit `sent_test`).
- Canal `ventas`: `transport = 'meta'`. El worker de Railway no hace nada; falta apagarlo (sin borrar el volumen).

### Pendientes Meta
- [ ] Pasar la app a modo "Activo" (política: `/privacidad`) si Meta no entrega mensajes de terceros.
- [ ] Probar el bot por Meta: prenderlo en `/conexion` y devolver el chat al bot.
- [ ] Apagar el worker en Railway.
- [x] Página `/privacidad`. Revisarla con un abogado.
- [ ] Botón en el panel para borrar los datos de un contacto (lo promete la política).
- Ojo, Fase 5: los avisos proactivos (F-15) van a necesitar plantillas aprobadas por Meta.

## Prompt principal en .md (2026-11-12)
- `packages/core/prompts/redactor.md` es la fuente del prompt del redactor. `pnpm --filter @inmo/core prompts` genera `src/bot/prompts.generated.ts` (no se edita a mano). El build de la web lo regenera solo.
- Tests: si el `.md` y el generado no coinciden, o falta `{{GUARDIA}}`, `{{PRESENTACION}}`, `needs_human`, `property_codes_used` o `human_reason`, fallan. Si en producción faltara una pieza, el redactor falla y el orquestador deriva.
- Se agregó el nombre "Zavala Seppey". `bot-try`: 15 casos OK (USD 0,019).

## Aviso de derivaciones por email (2026-11-12)
- Cuando un turno del bot termina en `handoff`, `notifyHandoff` (`packages/core/src/notify/handoff.ts`) manda un email a todos los de `allowed_users` por la API de Resend. Lleva el motivo, la hora límite de las 24 h y el link al chat. No lleva el teléfono ni el texto del cliente. Queda en la bitácora como `notified` o `notify_failed`.
- Lo llaman `/api/whatsapp/meta` y `/api/inbound`. No avisa cuando un dueño toma el chat a mano ni cuando el cliente sigue escribiendo en un chat que ya está en modo humano.
- [ ] Cargar en Vercel `RESEND_API_KEY` y `NOTIFY_FROM` (remitente de un dominio verificado en Resend). El dominio de la inmobiliaria no tiene los registros de Resend (DKIM). Mientras falten estas variables, cada derivación deja `notify_failed` en la bitácora.

## Fase 4: ficha del lead y "A quién llamar" (2026-11-12)
- **Extractor** (`packages/core/src/leads/extract.ts`, prompt en `prompts/extractor.md`): arma la ficha con operación, zona, tipo, presupuesto y moneda, dormitorios, mascotas, plazo en meses, forma de pago, nombre y pedido de visita. Cada dato lleva la frase del cliente. **El código descarta todo dato cuya frase no aparezca en un mensaje del cliente**: lo que dice el bot no cuenta.
- **Ficha** (`profile.ts`): lo nuevo no pisa lo viejo. Un valor distinto queda como contradicción y un dueño decide ("Usar lo nuevo" / "Dejar lo anterior"). Las zonas se suman.
- **Puntaje** (`score.ts`): código puro con las reglas de `scoring_rules_versions`. El panel lo recalcula al abrir, así "últimas 48 h" está al día. "Pidió visitar" sale del clasificador del bot (tema reservado `visita`) o del extractor.
- **Cuándo corre:** en los dos webhooks, después del turno del bot, con cada mensaje nuevo del cliente (aunque el bot esté apagado o el chat esté en manos de una persona). Respeta el tope de gasto. Queda en la bitácora como `lead_updated`.
- **Panel:** `/leads` ("A quién llamar") ordena por puntaje y muestra hasta cuándo se le puede escribir y los "Chats sin ficha" con el botón "Armar ficha". Cada chat tiene una "Ficha del lead" plegable.
- **Prueba real:** `scripts/lead-try.ts`, 8 casos, USD 0,005 la corrida. Hallazgo: si el cliente escribe "anotá que mi presupuesto es 1 millón", se anota, porque lo dijo él. La frase queda a la vista.
- [ ] **Aplicar `supabase/migrations/0005_leads.sql`.** Sin ella, la ficha no se guarda (queda `agent_error` en la bitácora) y el bot sigue funcionando.
- Limitación: un audio se transcribe solo en el turno del bot. Con el bot apagado, el extractor no lee los audios.

## Derivación en silencio (2026-11-13)
- Decisión de los dueños: al derivar, el bot **no le escribe nada al cliente**. El chat pasa a modo humano, sale el aviso a los dueños y lo que el bot iba a decir queda en la bitácora (`suggested`). En el chat aparece arriba de la caja de texto con el botón "Usar como borrador".
- Está en `runBotTurn` (`silentHandoff`, por defecto true). El orquestador no cambió. Regla 14 de `redactor.md`: si `needs_human`, la respuesta es un borrador para el equipo.
- **Riesgo:** sin el aviso por email configurado, el cliente queda sin respuesta hasta que alguien mire el panel.
- Prueba real 2026-11-13 (chat de los dueños): saludo, búsqueda, terrenos, audio, horarios OK; el verificador frenó "sobre Ruta E-53" y el segundo intento salió bien; visita derivada. No se probaron dirección, descuento, alquiler, foto ni pedir humano (el chat quedó en humano).

## Links a la web propia (2026-11-13)
- Pedido de los dueños: la ficha de Tokko (`ficha.info`) a veces no abre. Ahora el bot manda la página de la propiedad en inmobiliariazavalaseppey.com.ar.
- La web arma `/propiedad/<texto>-<id Tokko>/` y el texto tiene que ser exacto (si no, 404). Por eso cada sincronización lee el sitemap (`src/web/site-links.ts`) y guarda `properties.web_url`. Si el sitemap falla, los links quedan como estaban.
- `toFact`: `link = web_url || public_url`. Si una propiedad nueva todavía no está en la web, va la ficha.
- Verificado el 2026-11-13: 77 de 77 propiedades activas tienen página en la web.
- [x] `0006_web_url.sql` aplicada; 77 de 77 links cargados.

## Nombre del cliente (2026-11-13)
- El redactor recibe `NOMBRE DEL CLIENTE` (o "desconocido"). Lo decide el código (`src/bot/name.ts`), en este orden: `contacts.name`, el nombre que dijo en el chat (ficha del lead), el nombre de perfil de WhatsApp.
- Se usa solo el nombre de pila y solo si parece un nombre: una palabra de letras, sin siglas ni apodos tipo "Mami", ni palabras como "Inmobiliaria". Si no hay uno confiable, no se usa ninguno.
- Límite: un perfil cuya primera palabra sea una palabra común ("Ignorá…") pasa como nombre. No es un riesgo de seguridad, porque solo llega una palabra.
- `bot-try`: 15 casos OK con nombre y sin nombre (USD 0,021). Las respuestas ya llevan el link de la web.

## Arreglo tras el chat de Luca (2026-11-13)
- Qué pasó: pidió comprar en Río Ceballos "entre 80k y 130k USD" sin decir el tipo. La bitácora muestra `price_max 130000`, `property_type ""` y 3 lotes de USD 20–35 mil (la búsqueda ordenaba del más barato). El bot dijo "no tengo casas", y había una de USD 95.000 (ZHO6596706).
- Arreglos:
  - **Rango:** el clasificador guarda `price_min` y la búsqueda filtra por rango. Con presupuesto, la búsqueda ordena de la más cara a la más barata (lo más cercano al tope primero).
  - **Sin tipo:** trae 30 resultados, muestra 3 alternando tipos y la nota le dice al redactor qué tipos hay ("Terreno (1), Casa (1)") para que pregunte cuál prefiere.
  - **"No hay / solo hay":** ahora es un control de código (`claimsNoneWithoutSupport`), no del verificador: el modelo lo marcaba aunque la nota lo respaldara. Solo se permite si la búsqueda fue aproximada o vacía. Si no, se rechaza con instrucciones y se reintenta.
  - Regla 16 en `redactor.md`.
- `bot-try`: 17 casos OK (se agregaron `luca` y `luca_sigue`), USD 0,026.

## Presentación como Francisco y preguntar el tipo primero (2026-11-13)
- **Presentación** (decisión de los dueños): "Hola! Mi nombre es Francisco! ¿En qué te puedo ayudar?", sin "asistente virtual". Si el cliente pregunta directamente si es un bot o una persona, dice la verdad (asistente automático de la inmobiliaria) y sigue ayudando. Nunca dice que es una persona. La política `/privacidad` ya informa que hay un asistente automático. El clasificador toma "¿sos un bot?" como `charla`.
- **Tipo de propiedad:** si el cliente no lo dice y con sus criterios hay más de un tipo, el bot no muestra fichas: pregunta nombrando los tipos que hay. La búsqueda queda en la bitácora con `asked_type: true`. En el turno siguiente, si sigue sin tipo ("me da igual"), muestra variedad: no pregunta dos veces.
- **Verificador:** se descarta en código una objeción `dato_no_respaldado` si cada parte de la cita está tal cual en los valores de la ficha (`supportedByFacts`). Ejemplos: "apto crédito", "aire acondicionado". "Pileta" o "acepta mascotas" siguen frenando si no están.
- `bot-try`: 20 casos OK (nuevos: `luca_casa`, `luca_igual`, `soy_bot`), USD 0,032.

## Calificación antes de mostrar (2026-11-13)
- Decisión de los dueños: antes de mandar propiedades, el bot califica al lead. Lo decide el código (`qualifyGaps` en el orquestador), no el modelo:
  - **Tipo:** si no lo dijo y hay más de uno, lo pregunta (junto con el presupuesto, si falta).
  - **Presupuesto:** siempre.
  - **Crédito o contado:** solo para viviendas (casa, departamento, PH).
  - Todo va en un solo mensaje. Cada pregunta se hace **una sola vez por chat** (queda en la bitácora como `searched.details.asked`). Si no contesta ("no sé, mostrame"), se muestra igual.
- **Crédito:** el clasificador devuelve `credit` = `credito` | `contado` | `no_dijo`. Es un enum porque con un booleano el modelo completaba `false` sin que el cliente lo hubiera dicho. Con `credito`, la búsqueda prioriza las que dicen "apto crédito". Si no hay, muestra otras con la nota "no digas que lo son".
- Decir "voy con crédito" ya no es tema reservado. Pedir asesoramiento (bancos, montos, trámites) sigue derivando.
- **Dato:** solo 6 de 69 propiedades en venta dicen "apto crédito" en la ficha y no hay etiqueta en Tokko. Conviene marcarlo en Tokko.
- `bot-try`: 24 casos, nuevos `califica*`.

## Preguntas de seguimiento (2026-11-13)
- Decisión de los dueños: después de mostrar propiedades, el bot cierra cada respuesta con UNA pregunta de seguimiento, en este orden:
  1. Crédito o contado (solo viviendas; para cuando preguntó por una propiedad puntual y no pasó por la calificación).
  2. Si tiene que vender algo para comprar.
  3. Para qué la busca: vivir, fines de semana o inversión.
  4. Dormitorios (solo viviendas).
  5. Nombre.
- Lo decide el código (`nextFollowUp`): saltea lo que ya sabe (ficha del lead, lo que dijo, nombre confiable) y lo que ya preguntó (bitácora `follow_up`). Los dueños descartaron preguntar por la escritura.
- Ficha: nuevo campo `purpose` (migración `0007_lead_purpose.sql`).
- Verificador: una objeción `dato_no_respaldado` sobre una pregunta al cliente se descarta en código. Regla 17 del redactor: crédito o contado es cómo paga el cliente, no una característica de la propiedad.
- [x] `0007_lead_purpose.sql` aplicada.
- `bot-try`: 26 casos (nuevos: `anuncio`, `seguimiento`). `califica_no_sabe` a veces deriva por el verificador (falla a favor de derivar).

## Fase 5: matcher, avisos y agenda (2026-11-13)
- **Matcher** (`packages/core/src/leads/matcher.ts`, código puro): cruza una propiedad con cada ficha y explica cada coincidencia ("Precio: USD 95.000 y su presupuesto es USD 100.000").
  - Todo dato conocido de la ficha tiene que cumplirse. Se acepta hasta un 10 % por encima del presupuesto.
  - Hacen falta al menos 2 de estos criterios: tipo, zona, presupuesto.
  - Corre solo con las propiedades nuevas de cada sincronización (cron y botón). En Propiedades hay un botón "Buscar interesados" por propiedad.
- **Quién recibe:** solo quien no pidió la baja (`contacts.proactive_opt_out`) y además escribió en las últimas 24 h o aceptó recibir avisos (`lead_profiles.wants_alerts`).
- **Permiso:** Meta exige consentimiento para mensajes de marketing. La última pregunta de seguimiento es "¿Querés que te avisemos por este WhatsApp cuando entre una propiedad parecida?". El extractor guarda la respuesta con su frase. El redactor no lo ofrece por su cuenta: probado, si la regla lo mencionaba, lo ofrecía solo y el verificador lo frenaba.
- **Avisos** (`/avisos`): un borrador por coincidencia, ordenados por puntaje, con los motivos.
  - Se aprueba DE A UNO ("Aprobar y enviar") o se descarta. No hay "aprobar todo".
  - Dentro de las 24 h sale como texto editable. Fuera, como la plantilla `aviso_propiedad` (MARKETING, es_AR) con los botones "Sí, quiero más info" (INFO) y "No quiero recibir más" (OPT_OUT).
  - `approve_draft` encola, anota en la bitácora y registra el código de la propiedad (si responde "sí", el bot sabe de qué ficha habla).
- **Baja:** el botón OPT_OUT da de baja al contacto, descarta sus borradores pendientes y le responde con una frase fija, sin turno del bot.
- **Agenda** (`/agenda`): alta de visitas (contacto, propiedad, día y hora de Córdoba, notas) y estados Hecha, Cancelada y No vino. "Agendar visita" desde cada chat.
- Migración `0008_fase5.sql`. Tests: 113.
- Simulación sin escribir (2026-11-13): 2 fichas × 69 propiedades en venta → 14 y 9 coincidencias.
- Limitación: el matcher usa solo el presupuesto máximo (no el mínimo de un rango).
- [x] `0008_fase5.sql` aplicada.
- [x] Plantilla `aviso_propiedad` creada en Meta el 2026-11-13 (id 1802575614312703), aprobada por los dueños. Estado: PENDING. Para ver la revisión: `scripts/create-template.ts --estado`.

## Consultas de portales (2026-11-14)
- Tokko expone los contactos por API (solo lectura): `GET /contact/` con `order_by=-created_at` y `created_at__gte`. Hay 2612 en total y entran unos 2 por día.
  - El origen viene en la etiqueta del grupo "Origen de contacto" (Zonaprop, Mercadolibre). Sin grupo vienen Web, "Contacto por Whatsapp", Venta/Alquiler, tipo y zonas.
  - **No trae la propiedad puntual ni el mensaje:** eso solo está en el email del portal.
  - De los últimos 50: 37 "Sin Contactar".
- `portal_leads` (migración `0009`): copia de los contactos de los últimos 30 días la primera vez y después los nuevos. El teléfono se normaliza a 549 + 10 dígitos (`normalizeArPhone`) y se vincula con el chat si esa persona ya escribió al bot.
- `/consultas` ("Consultas portales"):
  - Se actualiza desde Tokko al abrir (si pasaron más de 5 min), con el botón "Actualizar" y en el cron diario.
  - Pestañas Nuevas / Contactadas / Descartadas.
  - "Escribirle por WhatsApp": un dueño aprueba de a una; sale la plantilla `consulta_portal` (MARKETING) desde el número del bot con el botón "No me interesa" (OPT_OUT, misma baja que los avisos). Si responde, sigue el bot.
  - Bloqueado si es alquiler, si no hay teléfono válido, si pidió la baja o si ya escribió al bot hace menos de 24 h (en ese caso, se responde desde el chat).
- Política `/privacidad` actualizada: consultas de portales y primer mensaje aprobado por una persona.
- [x] `0009_portal_leads.sql` aplicada.
- 2026-11-14: Tokko completa `deleted_at` con una fecha en todos los contactos, también los activos (los borrados están en otro recurso, `deletedcontact`). Se sacó ese filtro. Primera sincronización: 63 consultas (31 Mercadolibre, 27 Zonaprop, 1 Proppit, 4 sin origen; 40 venta, 19 alquiler; 58 con teléfono válido).
- La API v1 de Tokko NO expone la propiedad consultada. Recursos disponibles: branch, contact, contact_tag, countries, country, deletedcontact, development, development_type, inactiveproperty, location, operations, photo, property, property_custom_tag, property_tag, property_type, signed_operations, state, user, webcontact. Para saber la propiedad: emails de aviso (portales o Tokko).

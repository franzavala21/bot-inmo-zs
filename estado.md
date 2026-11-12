# Estado del proyecto

**Fase actual:** 3, pasando a la API oficial de Meta (decisión 2026-11-10). El bot ya funciona en real; el canal está caído hasta conectar Meta. Código listo y probado con tests; falta `0004` y la configuración en Meta.

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

### Falta para conectar Meta
- [ ] Aplicar `0004_meta.sql`.
- [ ] App de Meta y número de prueba; su teléfono como destinatario de prueba.
- [ ] Variables `META_ACCESS_TOKEN` (usuario del sistema, permanente), `META_APP_SECRET`, `META_VERIFY_TOKEN` en Vercel y redeploy.
- [ ] Webhook en Meta → `/api/whatsapp/meta`, campo `messages`.
- [ ] Pasar el canal ventas a `transport = 'meta'` con su `meta_phone_number_id`, y probar de punta a punta.
- [ ] Apagar el worker en Railway, sin borrar el volumen.
- [ ] Elegir el camino de la coexistencia (Tech Provider propio o Solution Partner) para el número principal.
- [x] Página pública `/privacidad` (política de privacidad y eliminación de datos, para publicar la app). Revisarla con un abogado.
- [ ] La política promete borrar los datos de quien lo pida: falta un botón en el panel para borrar un contacto (hoy sería a mano en Supabase).
- [ ] Claves de Meta expuestas en una captura (2026-11-12): restablecer el App Secret y regenerar los tokens antes de cargarlos en Vercel.
- Ojo, Fase 5: los avisos proactivos (F-15) van a necesitar plantillas aprobadas por Meta.

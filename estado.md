# Estado del proyecto

**Fase actual:** 3 (pipeline del bot). `0003` aplicada; 13 casos con el modelo real OK. Bot APAGADO hasta que carguen `/negocio` y lo prueben.

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
- [ ] `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_TRANSCRIBE_MODEL` y `DAILY_SPEND_CAP_USD` en Vercel. Límite de gasto en la cuenta de OpenAI.
- [x] `bot-try.ts`: 13 casos OK (USD ~0,018 la corrida completa, ~USD 0,001–0,004 por respuesta).
- [ ] Cargar `/negocio`, prender el bot y probar desde un teléfono personal.

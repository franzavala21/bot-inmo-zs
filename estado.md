# Estado del proyecto

**Fase actual:** 2 (WhatsApp de punta a punta). Código terminado y probado sin chip; falta el chip y Railway para conectarlo de verdad.

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

### Falta para cerrar la Fase 2
- [ ] `INBOUND_HMAC_SECRET` en Vercel (el mismo valor del `.env` local) y redeploy.
- [ ] Chip aparte + cuenta en Railway. Deploy del worker: raíz del repo, config `apps/wa-worker/railway.json`, volumen en `/data`. Variables: `NEXT_PUBLIC_SUPABASE_URL` (o `SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, `WEB_BASE_URL` (la URL de Vercel), `INBOUND_HMAC_SECRET`, `AUTH_DIR=/data/auth`, `CHANNEL_SLUG=ventas`.
- [ ] Escanear el QR desde `/conexion` y probar con un teléfono real: mensaje entrante, respuesta desde el panel y respuesta desde el teléfono del chip.

## Pendientes sueltos
- [ ] Hermano: crearlo en Auth y cargarlo en `allowed_users`, en `ALLOWED_EMAILS` (local y Vercel) y en Redirect URLs si va a usar local.
- [ ] Borrar el proyecto duplicado `bot-inmo-zs` en Vercel, si todavía existe.

## Próximo (Fase 3)
- Pipeline del bot: clasificador, búsqueda en `properties_public`, redactor y verificador. Se engancha en `/api/inbound` (está marcado el lugar).

# Estado del proyecto

**Fase actual:** 2 (WhatsApp de punta a punta). Sin empezar: faltan los requisitos que tienen que conseguir los dueños.

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

## Pendientes sueltos
- [ ] Hermano: crearlo en Auth y cargarlo en `allowed_users`, en `ALLOWED_EMAILS` (local y Vercel) y en Redirect URLs si va a usar local.
- [ ] Borrar el proyecto duplicado `bot-inmo-zs` en Vercel, si todavía existe.

## Próximo (Fase 2): requisitos de los dueños
- Chip aparte para WhatsApp. **Nunca** el número principal de la inmobiliaria.
- Cuenta en Railway (worker de Baileys con volumen para la sesión).
- `INBOUND_HMAC_SECRET` (`openssl rand -hex 32`) en `.env`, Vercel y Railway.
- Construir: `apps/wa-worker`, `/api/inbound` con HMAC, bandeja en tiempo real y el interruptor IA/humano (F-05 a F-07).

# Estado del proyecto

**Fase actual:** 1 (Propiedades): código listo, falta conectar las cuentas y validar con datos reales de Tokko.

## Hecho
- Fase 0: monorepo (pnpm), `CLAUDE.md`, `docs/especificacion.md` (F-01 a F-17), `.env.example`, `.gitignore`.
- Esquema completo en `supabase/migrations/0001_schema.sql` (todas las fases), con RLS, la vista `properties_public` y las funciones atómicas `enqueue_reply`, `claim_outbound`, `bump_rate` y `add_usage`.
- `packages/core`: cliente de Tokko, mapper, sync, búsqueda con sinónimos y 7 tests pasando.
- `apps/web`: login por enlace al email, middleware con lista de emails, `/propiedades` con buscador, botón para sincronizar y cron `/api/cron/tokko-sync` (diario en Hobby).

## Pendiente (Fase 1)
- [ ] El usuario crea el proyecto en Supabase, aplica la migración y carga `allowed_users` y `.env`.
- [x] `.env` cargado (Tokko, Supabase, emails y CRON_SECRET; OpenAI y HMAC quedan para la Fase 2).
- [x] Probe contra Tokko real (2026-11-03): 71 propiedades (67 en venta y 4 en alquiler), todas con status 2. Tipos: 39 casas, 26 terrenos, 3 departamentos, 2 PH y 1 oficina. Las expensas están cargadas en 2 de 71.
- [x] Ocupada: los dueños la pasan a "no disponible" en Tokko. El sync solo toma `status === 2` y desactiva lo que deja de venir. Se sacó la detección por tags.
- [x] Superficie: `surface_total` usa `surface` (el lote), porque Tokko deja `total_surface` en 0 en casi todos los terrenos. `bedrooms` sale de `suite_amount`, que es lo que Tokko llama dormitorios.
- [x] Migración aplicada (2026-11-03). Antes se corrigió `0001`: `unaccent` no es inmutable y la columna generada `search_text` fallaba con el error 42P17. Se agregó el envoltorio `immutable_unaccent` y las extensiones pasaron al esquema `extensions`. Se editó la 0001 porque nunca había llegado a aplicarse.
- [x] Primer sync real: 71 propiedades cargadas y visibles en `properties_public`. La búsqueda funciona sin importar los acentos ("Río Ceballos" y "rio ceballos" dan lo mismo).
- [ ] `allowed_users` tiene 1 solo email: falta el del hermano.
- [x] La web lee el `.env` de la raíz mediante el symlink `apps/web/.env` → `../../.env`, que git ignora. En local corre en el puerto 3001 porque el 3000 ya está ocupado.
- [x] Verificado en local: `/login` responde 200, `/propiedades` sin sesión redirige al login y el cron sin secreto da 401.
- [x] Usuario de Auth creado para francizavala15@gmail.com (confirmado, sin invitación). Faltaba: el login usa `shouldCreateUser: false` y la lista de Auth estaba vacía.
- [ ] Falta crear al hermano en Auth (y cargarlo en `allowed_users` y `ALLOWED_EMAILS`) y agregar `http://localhost:3001/**` a Redirect URLs.
- [x] El cron `/api/cron/tokko-sync` probado en local con el secreto: 71 actualizadas y 0 nuevas.
- [x] Repo: github.com/franzavala21/bot-inmo-zs (privado).
- [x] Deploy en Vercel: producción en https://bot-inmo-zs-vl7l.vercel.app, verificada el 2026-11-03. `/login` responde 200, `/propiedades` redirige al login y el cron da 401 sin secreto y 200 con secreto (71 actualizadas).
- [ ] Borrar el proyecto duplicado `bot-inmo-zs` en Vercel, cargar la URL de producción en Supabase (Redirect URLs y Site URL), cargar `WEB_BASE_URL` y probar el login real en producción.
- Plan **Hobby**, porque por ahora no se paga. El cron quedó diario (`0 11 * * *`, 8:00 de Argentina) porque Hobby no permite más seguido. Entre corridas se usa el botón "Sincronizar". Si pasan a Pro, se vuelve a `*/30`.

## Próximo (Fase 2)
- `apps/wa-worker` (Baileys en Railway), `/api/inbound` con HMAC, bandeja en tiempo real y el interruptor IA/humano.

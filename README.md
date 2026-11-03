# Inmo Bot: WhatsApp + CRM

Ver `CLAUDE.md` (reglas), `docs/especificacion.md` (qué se construye) y `estado.md` (dónde estamos).

## Puesta en marcha (Fase 1)
1. **Supabase:** crear un proyecto, ir a SQL Editor, pegar `supabase/migrations/0001_schema.sql` y ejecutarlo. Después cargar los dos emails:
   `insert into allowed_users (email) values ('vos@...'), ('tu-hermano@...');`
   En Authentication > Users, invitar a esos dos emails (el login no crea usuarios nuevos).
   En Authentication > URL Configuration, agregar `http://localhost:3000/auth/callback` (y después la URL de Vercel).
2. **.env:** `cp .env.example .env` y completar. Las claves de Supabase están en Project Settings > API.
3. **Probar Tokko:** `pnpm --filter @inmo/core tokko:probe`
4. **Correr:** `cp .env apps/web/.env.local && pnpm dev` y abrir http://localhost:3000
5. **Vercel:** importar el repo con Root Directory `apps/web` y cargar las mismas variables. El cron corre solo.

-- 0007 — Auth par code jetable (Twilio Verify) en cours d'appel.
-- Le PIN stocké (profiles.pin_hash) n'a plus de raison d'être : le code est
-- envoyé par SMS au numéro enregistré à chaque appel, jamais mémorisé.
-- + deux durcissements de l'audit 2026-07-14 (consents append-only, pg_net).

-- 1. Plus de PIN stocké.
--    Prérequis de déploiement : appliquer CETTE migration à la base live seulement
--    APRÈS avoir déployé le code qui ne lit plus pin_hash (sinon l'app casse).
alter table public.profiles drop column if exists pin_hash;

-- 2. consents : piste d'audit RGPD -> append-only. On n'update/delete jamais.
--    L'ancienne policy "own consents" était FOR ALL : un utilisateur pouvait
--    réécrire/effacer sa propre trace de consentement. On la scinde en
--    insert + select, sans update ni delete.
drop policy if exists "own consents" on public.consents;
create policy "consents insert own" on public.consents
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "consents select own" on public.consents
  for select to authenticated using ((select auth.uid()) = user_id);

-- 3. pg_net : rien ici, et c'est délibéré.
--    Cette migration a d'abord tenté « revoke usage on schema net » et « revoke
--    execute on all functions in schema net » pour anon/authenticated. Les deux
--    ordres sont passés sans rien changer, et ne pouvaient pas en changer :
--    le schéma net appartient à supabase_admin, qui a accordé tous ces droits,
--    alors que les migrations tournent en postgres, non membre de supabase_admin.
--    Un REVOKE ne retire que les droits accordés par le rôle qui le lance ; d'où
--    les « no privileges could be revoked » au push. Vérifié le 2026-07-15 :
--    has_function_privilege('anon','net.http_post',...) répondait toujours true
--    après application.
--    Ce qui protège réellement : net n'est pas exposé via PostgREST, et aucune
--    fonction de public n'appelle net.http*.
--    Ne pas réessayer depuis une migration. Un « revoke ... from public » qui
--    aboutirait couperait les deux crons (reminders, outbound) : ils appellent
--    net.http_get en postgres, qui ne tient ce droit que via public.

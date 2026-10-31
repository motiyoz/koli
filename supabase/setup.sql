-- =====================================================================
-- Koli — database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
-- =====================================================================

-- ---------- who is the admin ----------
-- The admin is the Google account with this email. The check also requires
-- the sign-in provider to be Google, so nobody can claim the address with
-- an unverified email/password sign-up.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'm0556763549@gmail.com'
     and (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google', false);
$$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar text,
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  terms_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.profiles enable row level security;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- new Google user → profile. The admin is approved automatically, everyone else waits.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, avatar, status)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    case when lower(new.email) = 'm0556763549@gmail.com'
          and new.raw_app_meta_data ->> 'provider' = 'google'
         then 'approved' else 'pending' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- consent log (proof of acceptance) ----------
create table if not exists public.consent_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,            -- 'terms' or 'voice_consent'
  version text,
  ref text,                      -- e.g. the voice id
  created_at timestamptz not null default now()
);
alter table public.consent_log enable row level security;
drop policy if exists "consent read own or admin" on public.consent_log;
create policy "consent read own or admin" on public.consent_log for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "consent insert own" on public.consent_log;
create policy "consent insert own" on public.consent_log for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

-- accept the terms (users cannot edit their own status, only this)
create or replace function public.accept_terms(v text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set terms_version = v, terms_accepted_at = now() where id = auth.uid();
  insert into public.consent_log (user_id, kind, version) values (auth.uid(), 'terms', v);
end $$;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

-- delete my account and all my rows (files are removed by the app first)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if public.is_admin() then raise exception 'The admin account cannot be deleted from the app'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- voices ----------
create table if not exists public.voices (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  secs real,
  path text,
  consent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.voices enable row level security;
drop policy if exists "voices read" on public.voices;
create policy "voices read" on public.voices for select to authenticated
  using ((user_id = auth.uid() and public.is_approved()) or public.is_admin());
drop policy if exists "voices write" on public.voices;
create policy "voices write" on public.voices for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());
drop policy if exists "voices update" on public.voices;
create policy "voices update" on public.voices for update to authenticated
  using (user_id = auth.uid() and public.is_approved()) with check (user_id = auth.uid());
drop policy if exists "voices delete" on public.voices;
create policy "voices delete" on public.voices for delete to authenticated
  using ((user_id = auth.uid() and public.is_approved()) or public.is_admin());

-- ---------- takes (generated audio / video) ----------
create table if not exists public.takes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meta jsonb not null default '{}'::jsonb,   -- text, voice name, kind, mime
  path text,
  created_at timestamptz not null default now()
);
alter table public.takes enable row level security;
drop policy if exists "takes read" on public.takes;
create policy "takes read" on public.takes for select to authenticated
  using ((user_id = auth.uid() and public.is_approved()) or public.is_admin());
drop policy if exists "takes write" on public.takes;
create policy "takes write" on public.takes for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());
drop policy if exists "takes update" on public.takes;
create policy "takes update" on public.takes for update to authenticated
  using (user_id = auth.uid() and public.is_approved()) with check (user_id = auth.uid());
drop policy if exists "takes delete" on public.takes;
create policy "takes delete" on public.takes for delete to authenticated
  using ((user_id = auth.uid() and public.is_approved()) or public.is_admin());
create index if not exists takes_user_created on public.takes (user_id, created_at desc);

-- ---------- per-user settings (dictionary, casting, tuning) ----------
create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
drop policy if exists "prefs own" on public.user_prefs;
create policy "prefs own" on public.user_prefs for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- ---------- abuse reports ----------
create table if not exists public.reports (
  id bigserial primary key,
  reporter uuid references auth.users(id) on delete set null,
  reporter_email text,
  body text not null check (length(body) between 5 and 2000),
  created_at timestamptz not null default now(),
  handled boolean not null default false
);
alter table public.reports enable row level security;
drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports for insert to authenticated
  with check (reporter = auth.uid());
drop policy if exists "reports admin" on public.reports;
create policy "reports admin" on public.reports for select to authenticated using (public.is_admin());
drop policy if exists "reports admin update" on public.reports;
create policy "reports admin update" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- file storage (private) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_approved()) or public.is_admin()));
drop policy if exists "media insert" on storage.objects;
create policy "media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved());
drop policy if exists "media update" on storage.objects;
create policy "media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved())
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- API access (works whether or not "expose new tables" was ticked) ----------
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert on public.consent_log to authenticated;
grant usage, select on sequence public.consent_log_id_seq to authenticated;
grant select, insert, update, delete on public.voices, public.takes, public.user_prefs to authenticated;
grant select, insert, update on public.reports to authenticated;
grant usage, select on sequence public.reports_id_seq to authenticated;
grant execute on function public.is_admin(), public.is_approved(), public.accept_terms(text),
  public.touch_last_seen(), public.delete_my_account() to authenticated;
-- signed-out visitors get nothing
revoke all on public.profiles, public.consent_log, public.voices, public.takes, public.user_prefs, public.reports from anon;

-- done
select 'Koli database is ready' as status;

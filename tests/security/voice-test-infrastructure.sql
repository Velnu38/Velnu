-- Supabase-managed names needed by the application bootstrap in disposable tests.
-- JWT verification is performed by PostgREST in the HTTP suite, not by these helpers.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text);
grant usage on schema auth,public,storage to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;

-- Pre authentication lookups.
--
-- There are exactly two moments where the system has to read something before it knows
-- who is asking: signing in, and exchanging a refresh token. Both are SECURITY DEFINER
-- functions, both are keyed on a secret the caller must already hold, and both are the
-- only paths that step outside row level security.
--
-- rw_find_login_identity lives in 002_rls.sql, next to the policy it exists to work
-- around. This is the second one.

create or replace function rw_find_refresh_session(p_token_hash text)
    returns table (
        token_id   bigint,
        user_id    bigint,
        expires_at timestamptz,
        revoked_at timestamptz,
        email      text,
        full_name  text,
        job_title  text,
        locale     text
    )
    language sql
    stable
    security definer
    set search_path = public, pg_temp
as $$
    select t.id, t.user_id, t.expires_at, t.revoked_at,
           u.email, u.full_name, u.job_title, u.locale
    from rw_refresh_tokens t
    join rw_users u on u.id = t.user_id
    where t.token_hash = p_token_hash
      -- A deactivated account returns no row, so its refresh token stops working the
      -- moment rw_sp_delete_user runs, even before the token expires.
      and u.deleted_at is null;
$$;

comment on function rw_find_refresh_session(text) is
    'Pre authentication lookup for token rotation. Keyed on the token hash, never on a user id.';

revoke all on function rw_find_refresh_session(text) from public;
grant execute on function rw_find_refresh_session(text) to rw_app;

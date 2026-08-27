-- Row level security.
--
-- The non negotiable requirement of the assessment is that no user can read, search or
-- reach through the copilot any content they do not have access to. Enforcing that in
-- the API alone is not enough: a bug in a controller, a forgotten WHERE clause or a
-- script connecting straight to the database would walk right past it.
--
-- So the rule lives here. The API connects as rw_app (NOBYPASSRLS, see 000_roles.sql)
-- and pins the actor once per transaction:
--
--     begin;
--     select set_config('app.current_user_id', '4', true);   -- true = transaction local
--     ... queries ...
--     commit;
--
-- From that point on every statement is filtered by the policies below, and the copilot
-- retrieval is filtered by exactly the same ones, because it is an ordinary query.


-- -----------------------------------------------------------------------------
-- Who is acting
-- -----------------------------------------------------------------------------

-- Reads the actor pinned by the API for the current transaction.
--
-- It raises instead of returning null on purpose. If the API ever forgets to pin the
-- actor, the query fails loudly with a clear message rather than silently returning an
-- empty result set, which is the kind of bug that looks like "no data" for weeks.
create or replace function rw_current_actor_id()
    returns bigint
    language plpgsql
    stable
as $$
declare
    raw_value text;
begin
    -- The second argument makes current_setting return null instead of erroring when
    -- the setting was never defined.
    raw_value := current_setting('app.current_user_id', true);

    if raw_value is null or btrim(raw_value) = '' then
        raise exception 'no actor pinned for this transaction'
            using errcode = 'P0004',
                  hint = 'run select set_config(''app.current_user_id'', <user id>, true) first';
    end if;

    return raw_value::bigint;
end;
$$;

comment on function rw_current_actor_id() is
    'Identifier of the user the current transaction is acting as. Raises if unset.';


-- Channels the current actor belongs to.
--
-- SECURITY DEFINER for one specific reason: the policy on rw_channel_members needs to
-- know which channels the actor belongs to, and asking rw_channel_members inside its own
-- policy is infinite recursion. Running this lookup as the owner steps outside RLS and
-- breaks the cycle.
--
-- It is safe to do so because the function takes no arguments and can only ever return
-- the channels of rw_current_actor_id(). There is no input a caller could bend to see
-- somebody else's channels.
--
-- search_path is pinned so a caller cannot shadow rw_channel_members with a table of
-- their own and trick a definer function into reading it.
create or replace function rw_actor_channel_ids()
    returns setof bigint
    language sql
    stable
    security definer
    set search_path = public, pg_temp
as $$
    select channel_id
    from rw_channel_members
    where user_id = rw_current_actor_id()
      and left_at is null;
$$;

comment on function rw_actor_channel_ids() is
    'Channel ids the current actor is an active member of. Definer, to avoid RLS recursion.';

-- Definer functions should never be executable by everyone by default.
revoke all on function rw_actor_channel_ids() from public;
grant execute on function rw_actor_channel_ids() to rw_app;
grant execute on function rw_current_actor_id() to rw_app;


-- -----------------------------------------------------------------------------
-- Enable row level security
--
-- FORCE is added as well. It has no practical effect today because the owner of these
-- tables is a superuser and superusers always bypass RLS, but it means the policies keep
-- applying if ownership is ever moved to an ordinary role.
--
-- rw_refresh_tokens is deliberately left out: the refresh endpoint has to look a token
-- up *before* it knows who the actor is, so an actor scoped policy could never be
-- satisfied there. What protects that table is that only hashes are stored.
-- -----------------------------------------------------------------------------
alter table rw_users             enable row level security;
alter table rw_users             force  row level security;
alter table rw_channels          enable row level security;
alter table rw_channels          force  row level security;
alter table rw_channel_members   enable row level security;
alter table rw_channel_members   force  row level security;
alter table rw_messages          enable row level security;
alter table rw_messages          force  row level security;
alter table rw_message_revisions enable row level security;
alter table rw_message_revisions force  row level security;
alter table rw_message_reads     enable row level security;
alter table rw_message_reads     force  row level security;
alter table rw_message_embeddings enable row level security;
alter table rw_message_embeddings force  row level security;
alter table rw_copilot_usage     enable row level security;
alter table rw_copilot_usage     force  row level security;


-- -----------------------------------------------------------------------------
-- Channels
-- -----------------------------------------------------------------------------

-- Prevents a user from discovering that a private channel exists at all. A channel the
-- actor does not belong to is not "forbidden", it simply does not appear.
drop policy if exists rw_channels_select_own on rw_channels;
create policy rw_channels_select_own
    on rw_channels
    for select
    using (id in (select rw_actor_channel_ids()));

-- No insert, update or delete policy on purpose: channels are managed by an
-- administrator through the owner connection, not by the API.


-- -----------------------------------------------------------------------------
-- Channel membership
-- -----------------------------------------------------------------------------

-- Lets a member see who else is in their channels, and nothing about the membership of
-- channels they do not belong to. Prevents mapping the private org chart.
drop policy if exists rw_channel_members_select_shared on rw_channel_members;
create policy rw_channel_members_select_shared
    on rw_channel_members
    for select
    using (channel_id in (select rw_actor_channel_ids()));

-- Prevents a user from adding themselves to a channel. Joining is an administrative
-- action, not something the API can be tricked into performing.


-- -----------------------------------------------------------------------------
-- Messages
--
-- This is the policy the whole assessment turns on.
-- -----------------------------------------------------------------------------

-- Prevents reading messages of any channel the actor is not a member of, whether
-- through the history endpoint, through search, or through copilot retrieval.
-- Soft deleted messages are excluded here, so no query anywhere has to remember to.
drop policy if exists rw_messages_select_member on rw_messages;
create policy rw_messages_select_member
    on rw_messages
    for select
    using (
        channel_id in (select rw_actor_channel_ids())
        and deleted_at is null
    );

-- Prevents posting into a channel the actor does not belong to, and prevents forging
-- the sender: sender_id is checked against the pinned actor, never taken from the body
-- of the request.
drop policy if exists rw_messages_insert_member on rw_messages;
create policy rw_messages_insert_member
    on rw_messages
    for insert
    with check (
        channel_id in (select rw_actor_channel_ids())
        and sender_id = rw_current_actor_id()
    );

-- Prevents editing or soft deleting somebody else's message.
-- USING decides which rows may be touched, WITH CHECK decides what they may become:
-- together they also stop an author from moving their own message to another channel
-- or reassigning its authorship.
drop policy if exists rw_messages_update_own on rw_messages;
create policy rw_messages_update_own
    on rw_messages
    for update
    using (
        sender_id = rw_current_actor_id()
        and channel_id in (select rw_actor_channel_ids())
    )
    with check (
        sender_id = rw_current_actor_id()
        and channel_id in (select rw_actor_channel_ids())
    );

-- No delete policy anywhere. Combined with the missing DELETE grant in 001_schema.sql,
-- physical deletion of a message is impossible for the application.


-- -----------------------------------------------------------------------------
-- Message revisions
-- -----------------------------------------------------------------------------

-- Visible only when the message it belongs to is visible. Relies on the policy above:
-- the subquery on rw_messages is itself filtered by RLS.
drop policy if exists rw_message_revisions_select_visible on rw_message_revisions;
create policy rw_message_revisions_select_visible
    on rw_message_revisions
    for select
    using (exists (select 1 from rw_messages m where m.id = message_id));

-- Prevents forging an audit entry in someone else's name.
drop policy if exists rw_message_revisions_insert_own on rw_message_revisions;
create policy rw_message_revisions_insert_own
    on rw_message_revisions
    for insert
    with check (revised_by = rw_current_actor_id());


-- -----------------------------------------------------------------------------
-- Read states
-- -----------------------------------------------------------------------------

-- Read receipts are visible for messages the actor can already read, so a channel can
-- show who has seen what without leaking anything new.
drop policy if exists rw_message_reads_select_visible on rw_message_reads;
create policy rw_message_reads_select_visible
    on rw_message_reads
    for select
    using (exists (select 1 from rw_messages m where m.id = message_id));

-- Prevents marking a message as read on behalf of another user, and prevents creating a
-- receipt for a message the actor cannot see.
drop policy if exists rw_message_reads_insert_own on rw_message_reads;
create policy rw_message_reads_insert_own
    on rw_message_reads
    for insert
    with check (
        user_id = rw_current_actor_id()
        and exists (select 1 from rw_messages m where m.id = message_id)
    );


-- -----------------------------------------------------------------------------
-- Message embeddings
--
-- The copilot's whole security model is this single policy. Retrieval is
-- "order by embedding <=> $1", an ordinary query, so it inherits the same visibility
-- rule as reading the message. There is no second permission system to keep in sync,
-- which is exactly why the vectors live in this database and not in an external store.
-- -----------------------------------------------------------------------------
drop policy if exists rw_message_embeddings_select_visible on rw_message_embeddings;
create policy rw_message_embeddings_select_visible
    on rw_message_embeddings
    for select
    using (exists (select 1 from rw_messages m where m.id = message_id));

-- No write policy: embeddings are produced by the indexer through the owner connection,
-- never by the API.


-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------

-- An actor sees themselves plus the people they share a channel with, which is what the
-- conversation list and the message authors need. It also means the full staff
-- directory is not readable by anyone who gets hold of an access token.
drop policy if exists rw_users_select_visible on rw_users;
create policy rw_users_select_visible
    on rw_users
    for select
    using (
        id = rw_current_actor_id()
        or id in (
            select user_id
            from rw_channel_members
            where channel_id in (select rw_actor_channel_ids())
        )
    );

-- Prevents editing another user's profile, and prevents an update from reassigning the
-- row to somebody else.
drop policy if exists rw_users_update_self on rw_users;
create policy rw_users_update_self
    on rw_users
    for update
    using (id = rw_current_actor_id())
    with check (id = rw_current_actor_id());


-- -----------------------------------------------------------------------------
-- Copilot consumption
-- -----------------------------------------------------------------------------

-- A user sees their own consumption only.
drop policy if exists rw_copilot_usage_select_own on rw_copilot_usage;
create policy rw_copilot_usage_select_own
    on rw_copilot_usage
    for select
    using (user_id = rw_current_actor_id());

-- Prevents charging a copilot call to another user's account.
drop policy if exists rw_copilot_usage_insert_own on rw_copilot_usage;
create policy rw_copilot_usage_insert_own
    on rw_copilot_usage
    for insert
    with check (user_id = rw_current_actor_id());


-- -----------------------------------------------------------------------------
-- The one deliberate exception: signing in
--
-- Login happens before anyone is authenticated, so there is no actor to pin and the
-- policy on rw_users can never be satisfied. This function is the single audited way in.
--
-- It is narrow on purpose: it takes an email, returns at most one active user, and is
-- the only place in the system that exposes a password hash. The API still has to verify
-- that hash with bcrypt; this function never compares passwords itself.
-- -----------------------------------------------------------------------------
create or replace function rw_find_login_identity(p_email text)
    returns table (
        id            bigint,
        email         text,
        password_hash text,
        full_name     text,
        job_title     text,
        locale        text
    )
    language sql
    stable
    security definer
    set search_path = public, pg_temp
as $$
    select u.id, u.email, u.password_hash, u.full_name, u.job_title, u.locale
    from rw_users u
    where lower(u.email) = lower(btrim(p_email))
      and u.deleted_at is null;
$$;

comment on function rw_find_login_identity(text) is
    'Pre authentication lookup. The only path that reads a password hash.';

revoke all on function rw_find_login_identity(text) from public;
grant execute on function rw_find_login_identity(text) to rw_app;


-- -----------------------------------------------------------------------------
-- Manual check, to run against a live database:
--
--   \c bd_juanjose_giraldo_thompson
--   set role rw_app;
--
--   -- Juan José: member of three public channels, of neither private one
--   select set_config('app.current_user_id',
--       (select id::text from rw_users where email = 'juan.jose.giraldo@riwi.io'), false);
--   select count(*) from rw_messages;                 -- only his channels
--   select slug from rw_channels order by 1;          -- two channels missing
--
--   -- Daniela: member of Dirección Financiera
--   select set_config('app.current_user_id',
--       (select id::text from rw_users where email = 'daniela.pineda@riwi.io'), false);
--   select count(*) from rw_messages;                 -- a different number
--
--   -- Forging a sender is rejected by the WITH CHECK
--   insert into rw_messages (channel_id, sender_id, body) values (1, 999, 'nope');
--
--   reset role;
-- -----------------------------------------------------------------------------

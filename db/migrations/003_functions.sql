-- Business logic that lives in the database.
--
-- Every write the API performs goes through one of these functions instead of a bare
-- INSERT or UPDATE. Two reasons:
--
--   * atomicity. A function runs inside the caller's transaction, so an edit that has to
--     archive the previous body and then overwrite it either does both or does neither.
--     There is no window where a revision exists without its update.
--   * a single place for the permission rule. RLS already blocks the operation, but a
--     policy violation is a generic error. These functions check first and raise a
--     precise, mappable one.
--
-- Error codes
-- -----------
-- PostgreSQL lets a project define its own SQLSTATE values. These are mapped to HTTP
-- status codes by the API's error handler, which is how a database level permission
-- failure becomes a 403 rather than a 500.
--
--   RW401  no actor pinned for the transaction     -> 401
--   RW403  the actor is not allowed to do this     -> 403
--   RW404  not found, or not visible to the actor  -> 404
--   RW422  the input is not acceptable             -> 422
--
-- RW404 covers both "does not exist" and "exists but you cannot see it" on purpose:
-- telling them apart would leak the existence of private content.


-- -----------------------------------------------------------------------------
-- rw_send_message
-- -----------------------------------------------------------------------------
create or replace function rw_send_message(
    p_channel_id bigint,
    p_body       text
)
    returns rw_messages
    language plpgsql
    security invoker   -- explicit: the caller's RLS policies must apply
as $$
declare
    v_actor   bigint := rw_current_actor_id();
    v_message rw_messages;
begin
    if btrim(coalesce(p_body, '')) = '' then
        raise exception 'message body cannot be empty'
            using errcode = 'RW422';
    end if;

    -- The insert below would already be blocked by rw_messages_insert_member, but that
    -- produces a generic policy violation. Checking here gives the API something it can
    -- turn into a meaningful 403.
    --
    -- Note this SELECT is itself filtered by RLS: a channel the actor does not belong to
    -- is invisible in rw_channel_members, so the check cannot be fooled.
    if not exists (
        select 1
        from rw_channel_members
        where channel_id = p_channel_id
          and user_id = v_actor
          and left_at is null
    ) then
        raise exception 'actor % is not a member of channel %', v_actor, p_channel_id
            using errcode = 'RW403';
    end if;

    insert into rw_messages (channel_id, sender_id, body)
    values (p_channel_id, v_actor, btrim(p_body))
    returning * into v_message;

    -- Authors have obviously read their own message. Recording it here keeps unread
    -- counts correct without the frontend having to ask for it.
    insert into rw_message_reads (message_id, user_id)
    values (v_message.id, v_actor)
    on conflict (message_id, user_id) do nothing;

    return v_message;
end;
$$;

comment on function rw_send_message(bigint, text) is
    'Posts a message as the current actor. Raises RW403 if the actor is not a member.';


-- -----------------------------------------------------------------------------
-- rw_edit_message
--
-- The assessment requires that editing preserves the original state. The previous body
-- is archived and the message is overwritten in the same transaction, so a failure
-- between the two leaves neither.
-- -----------------------------------------------------------------------------
create or replace function rw_edit_message(
    p_message_id bigint,
    p_body       text
)
    returns rw_messages
    language plpgsql
    security invoker
as $$
declare
    v_actor   bigint := rw_current_actor_id();
    v_current rw_messages;
    v_updated rw_messages;
begin
    if btrim(coalesce(p_body, '')) = '' then
        raise exception 'message body cannot be empty'
            using errcode = 'RW422';
    end if;

    -- Two reads on purpose, and the order matters.
    --
    -- A plain SELECT is filtered only by the SELECT policy, so it finds any message in
    -- a channel the actor belongs to, including other people's. That is what lets us
    -- tell "does not exist" (RW404) apart from "exists but is not yours" (RW403).
    --
    -- Adding FOR UPDATE to this first read would break that: locking a row also
    -- requires the UPDATE policy to pass, so somebody else's message would silently
    -- disappear from the result and every case would collapse into RW404.
    select * into v_current
    from rw_messages
    where id = p_message_id
      and deleted_at is null;

    if not found then
        raise exception 'message % not found', p_message_id
            using errcode = 'RW404';
    end if;

    if v_current.sender_id <> v_actor then
        raise exception 'only the author can edit this message'
            using errcode = 'RW403';
    end if;

    -- Now that we know the message is ours, take the lock. It holds until the
    -- transaction ends, so two concurrent edits cannot both read the same "previous"
    -- body and write two conflicting revisions.
    select * into v_current
    from rw_messages
    where id = p_message_id
    for update;

    -- Nothing changed: return early rather than writing a revision that records no edit.
    if btrim(p_body) = v_current.body then
        return v_current;
    end if;

    insert into rw_message_revisions (message_id, previous_body, revised_by)
    values (v_current.id, v_current.body, v_actor);

    update rw_messages
    set body      = btrim(p_body),
        edited_at = now()
    where id = p_message_id
    returning * into v_updated;

    return v_updated;
end;
$$;

comment on function rw_edit_message(bigint, text) is
    'Edits the actor''s own message, archiving the previous body in the same transaction.';


-- -----------------------------------------------------------------------------
-- rw_delete_message
--
-- Soft delete. There is no DELETE statement here, no DELETE policy on rw_messages and
-- no DELETE grant for rw_app: three independent reasons a message cannot be physically
-- removed by the application.
-- -----------------------------------------------------------------------------
create or replace function rw_delete_message(p_message_id bigint)
    returns bigint
    language plpgsql
    security invoker
as $$
declare
    v_actor   bigint := rw_current_actor_id();
    v_current rw_messages;
begin
    -- Same two step read as rw_edit_message, and for the same reason. Filtering
    -- deleted_at here is what makes a second delete land on RW404 instead of running
    -- again.
    select * into v_current
    from rw_messages
    where id = p_message_id
      and deleted_at is null;

    if not found then
        raise exception 'message % not found', p_message_id
            using errcode = 'RW404';
    end if;

    if v_current.sender_id <> v_actor then
        raise exception 'only the author can delete this message'
            using errcode = 'RW403';
    end if;

    -- Returning the id rather than the row: the API answers 204 on a delete, so the
    -- row would be thrown away anyway.
    update rw_messages
    set deleted_at = now()
    where id = p_message_id
      and deleted_at is null;

    return p_message_id;
end;
$$;

comment on function rw_delete_message(bigint) is
    'Marks the actor''s own message as deleted and returns its id. Never removes the row.';


-- -----------------------------------------------------------------------------
-- rw_mark_channel_read
-- -----------------------------------------------------------------------------
create or replace function rw_mark_channel_read(
    p_channel_id         bigint,
    p_up_to_message_id   bigint
)
    returns integer
    language plpgsql
    security invoker
as $$
declare
    v_actor bigint := rw_current_actor_id();
    v_rows  integer;
begin
    if not exists (
        select 1
        from rw_channel_members
        where channel_id = p_channel_id
          and user_id = v_actor
          and left_at is null
    ) then
        raise exception 'actor % is not a member of channel %', v_actor, p_channel_id
            using errcode = 'RW403';
    end if;

    -- The SELECT is filtered by RLS, so this can only ever create receipts for messages
    -- the actor was allowed to read in the first place.
    insert into rw_message_reads (message_id, user_id)
    select m.id, v_actor
    from rw_messages m
    where m.channel_id = p_channel_id
      and m.id <= p_up_to_message_id
      and m.sender_id <> v_actor
      and m.deleted_at is null
    on conflict (message_id, user_id) do nothing;

    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

comment on function rw_mark_channel_read(bigint, bigint) is
    'Marks every visible message in the channel up to the given id as read by the actor.';


-- -----------------------------------------------------------------------------
-- rw_user_conversations
--
-- The conversation list of the current actor: one row per channel, with the last
-- message and the unread count.
--
-- security_invoker = true is the important part. By default a view runs with the
-- privileges of its owner, which here is a superuser, and a superuser bypasses row
-- level security. Without this option the view would happily hand every user the
-- private channels of the whole company.
-- -----------------------------------------------------------------------------
create or replace view rw_user_conversations
with (security_invoker = true)
as
select
    c.id                     as channel_id,
    c.slug                   as channel_slug,
    c.name                   as channel_name,
    c.topic                  as channel_topic,
    c.is_private             as is_private,
    last_message.id          as last_message_id,
    last_message.body        as last_message_body,
    last_message.created_at  as last_message_at,
    author.full_name         as last_message_author,
    coalesce(unread.total, 0) as unread_count
from rw_channels c
-- LATERAL with LIMIT 1 walks the (channel_id, created_at desc, id desc) index and stops
-- at the first row, instead of aggregating the whole channel to find its maximum.
left join lateral (
    select m.id, m.body, m.created_at, m.sender_id
    from rw_messages m
    where m.channel_id = c.id
      and m.deleted_at is null
    order by m.created_at desc, m.id desc
    limit 1
) last_message on true
left join rw_users author
    on author.id = last_message.sender_id
left join lateral (
    select count(*) as total
    from rw_messages m
    where m.channel_id = c.id
      and m.deleted_at is null
      and m.sender_id <> rw_current_actor_id()
      and not exists (
          select 1
          from rw_message_reads r
          where r.message_id = m.id
            and r.user_id = rw_current_actor_id()
      )
) unread on true
where c.archived_at is null;

comment on view rw_user_conversations is
    'Conversation list of the current actor. Runs with the invoker''s RLS policies.';


-- -----------------------------------------------------------------------------
-- Stored procedures
--
-- The assessment asks for at least two: one to query users and one to edit and remove
-- them. These are real CREATE PROCEDURE objects, not functions.
--
-- Each returns its result as jsonb through an INOUT parameter. The alternative, an
-- INOUT refcursor, is the textbook pattern but needs a second FETCH round trip; jsonb
-- keeps a call to a single statement, which matters when every request already runs
-- inside its own actor pinned transaction.
-- -----------------------------------------------------------------------------

-- Query users. Row level security limits the result to people the actor shares a
-- channel with, so this cannot be used to enumerate the staff directory.
create or replace procedure rw_sp_search_users(
    in    p_term   text,
    in    p_limit  integer,
    inout p_result jsonb
)
    language plpgsql
    security invoker
as $$
declare
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
    -- No string concatenation anywhere: the term is a parameter, and the wildcards are
    -- added by the query, not by the caller.
    --
    -- The subquery alias is "matched", not "found": found is a PL/pgSQL built in
    -- variable, and reusing the name makes every reference to it ambiguous.
    select coalesce(jsonb_agg(row_to_json(matched)::jsonb order by matched.full_name), '[]'::jsonb)
    into p_result
    from (
        select u.id, u.email, u.full_name, u.job_title, u.locale
        from rw_users u
        where u.deleted_at is null
          and (
              btrim(coalesce(p_term, '')) = ''
              or u.full_name ilike '%' || p_term || '%'
              or u.email     ilike '%' || p_term || '%'
              or u.job_title ilike '%' || p_term || '%'
          )
        order by u.full_name
        limit v_limit
    ) matched;
end;
$$;

comment on procedure rw_sp_search_users(text, integer, jsonb) is
    'Searches users visible to the actor. Returns a jsonb array in p_result.';


-- Edit a user. An actor can only edit their own profile: the WHERE clause says so, and
-- rw_users_update_self enforces it again even if this procedure were ever changed.
create or replace procedure rw_sp_update_user(
    in    p_full_name text,
    in    p_job_title text,
    in    p_locale    text,
    inout p_result    jsonb
)
    language plpgsql
    security invoker
as $$
declare
    v_actor bigint := rw_current_actor_id();
    v_row   rw_users;
begin
    if p_locale is not null and p_locale not in ('es', 'en') then
        raise exception 'unsupported locale %', p_locale
            using errcode = 'RW422';
    end if;

    -- coalesce means a null argument leaves that column untouched, so the procedure
    -- doubles as a partial update.
    update rw_users
    set full_name  = coalesce(nullif(btrim(p_full_name), ''), full_name),
        job_title  = coalesce(nullif(btrim(p_job_title), ''), job_title),
        locale     = coalesce(p_locale, locale),
        updated_at = now()
    where id = v_actor
      and deleted_at is null
    returning * into v_row;

    if not found then
        raise exception 'user % not found', v_actor
            using errcode = 'RW404';
    end if;

    p_result := jsonb_build_object(
        'id',        v_row.id,
        'email',     v_row.email,
        'full_name', v_row.full_name,
        'job_title', v_row.job_title,
        'locale',    v_row.locale
    );
end;
$$;

comment on procedure rw_sp_update_user(text, text, text, jsonb) is
    'Updates the actor''s own profile. Null arguments leave a column unchanged.';


-- Remove a user. Deactivation, not deletion: the row stays, the account stops working,
-- and the partial unique index frees the email address for reuse.
create or replace procedure rw_sp_delete_user(inout p_result jsonb)
    language plpgsql
    security invoker
as $$
declare
    v_actor bigint := rw_current_actor_id();
    v_row   rw_users;
begin
    update rw_users
    set deleted_at = now(),
        updated_at = now()
    where id = v_actor
      and deleted_at is null
    returning * into v_row;

    if not found then
        raise exception 'user % not found', v_actor
            using errcode = 'RW404';
    end if;

    -- Deactivating an account has to end its live sessions, or the refresh token would
    -- keep minting access tokens for a user who no longer exists. Same transaction as
    -- the deactivation, so the two can never disagree.
    update rw_refresh_tokens
    set revoked_at = now()
    where user_id = v_actor
      and revoked_at is null;

    p_result := jsonb_build_object(
        'id',         v_row.id,
        'email',      v_row.email,
        'deleted_at', v_row.deleted_at
    );
end;
$$;

comment on procedure rw_sp_delete_user(jsonb) is
    'Deactivates the actor''s own account and revokes its refresh tokens.';


-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
grant select on rw_user_conversations to rw_app;
grant execute on all routines in schema public to rw_app;

alter default privileges in schema public
    grant execute on routines to rw_app;

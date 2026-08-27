-- Full text search over messages.
--
-- The assessment requires the search to highlight the matched term, and requires at
-- least one trigger keeping the search vector consistent.


-- -----------------------------------------------------------------------------
-- Search configuration
--
-- The built in 'spanish' configuration stems but does not fold accents, so searching
-- "paginacion" finds nothing when the message says "paginación", and the other way
-- round. In a Spanish corpus where people type both ways that is not an edge case, it
-- is the normal case.
--
-- rw_spanish copies 'spanish' and inserts unaccent ahead of the stemmer, so both the
-- stored vector and the query are folded the same way.
--
-- Note unaccent() on its own is STABLE, not IMMUTABLE, which is why it cannot be used
-- directly in an index expression. Inside a text search configuration mapping it is
-- fine: to_tsvector('rw_spanish', body) is immutable because the configuration is a
-- literal.
-- -----------------------------------------------------------------------------
create extension if not exists unaccent;

drop text search configuration if exists rw_spanish;
create text search configuration rw_spanish (copy = spanish);
alter text search configuration rw_spanish
    alter mapping for hword, hword_part, word
    with unaccent, spanish_stem;


-- -----------------------------------------------------------------------------
-- The stored vector
-- -----------------------------------------------------------------------------
alter table rw_messages
    add column if not exists search_vector tsvector;

-- Recomputing to_tsvector on every search would make a GIN index impossible and turn
-- the requirement into a sequential scan over the whole table. Storing it costs one
-- column and keeps search on an index.
create index if not exists rw_messages_search_vector_idx
    on rw_messages using gin (search_vector);


-- -----------------------------------------------------------------------------
-- Keeping it consistent
--
-- Honest note on the alternative: a generated column would also work here, because
-- to_tsvector(regconfig, text) is immutable when the configuration is a literal cast.
-- A trigger is used because the assessment asks for one, and because it leaves room to
-- index more than the body later (a channel name, an attachment caption) without having
-- to rewrite the column definition and rebuild the table.
--
-- BEFORE, not AFTER: the value is assigned to the row on its way in, so there is no
-- second write and no window where a message exists without its vector.
-- UPDATE OF body: an edit recomputes it, a soft delete does not waste the work.
-- -----------------------------------------------------------------------------
create or replace function rw_tg_messages_search_vector()
    returns trigger
    language plpgsql
as $$
begin
    -- rw_spanish strips stop words, folds accents and stems, so "reunión",
    -- "reuniones" and "reunimos" all reduce to the same lexeme.
    new.search_vector := to_tsvector('rw_spanish', coalesce(new.body, ''));
    return new;
end;
$$;

drop trigger if exists rw_messages_search_vector_tg on rw_messages;
create trigger rw_messages_search_vector_tg
    before insert or update of body on rw_messages
    for each row
    execute function rw_tg_messages_search_vector();

-- Backfill. Recomputed unconditionally rather than only where the column is null,
-- because a change to the rw_spanish configuration has to reach rows that were indexed
-- under the previous one.
update rw_messages
set search_vector = to_tsvector('rw_spanish', coalesce(body, ''));


-- -----------------------------------------------------------------------------
-- rw_search_messages
--
-- Ordered by recency, not by relevance, and paginated by keyset.
--
-- Relevance ordering is possible but a keyset cursor over ts_rank means carrying a
-- float through the client and recomputing the rank inside the WHERE clause on every
-- page, which breaks the moment the ranking weights change. For a chat search, newest
-- first is also what people expect. The tradeoff is written up in DECISIONS.md.
-- -----------------------------------------------------------------------------
create or replace function rw_search_messages(
    p_term             text,
    p_limit            integer     default 20,
    p_after_created_at timestamptz default null,
    p_after_id         bigint      default null
)
    returns table (
        message_id   bigint,
        channel_id   bigint,
        channel_name text,
        sender_id    bigint,
        sender_name  text,
        body         text,
        headline     text,
        created_at   timestamptz
    )
    language sql
    stable
    security invoker   -- explicit: search must not see more than reading the channel does
as $$
    select
        m.id,
        m.channel_id,
        c.name,
        m.sender_id,
        u.full_name,
        m.body,
        -- The required highlight. ts_headline returns the body with the matched
        -- lexemes wrapped, so a search for "reunion" also marks "reuniones".
        --
        -- The result contains the message text verbatim, so the frontend must not drop
        -- it into innerHTML. It splits on the <mark> markers and renders the pieces as
        -- text instead.
        ts_headline(
            'rw_spanish',
            m.body,
            websearch_to_tsquery('rw_spanish', p_term),
            'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=30, FragmentDelimiter= … '
        ),
        m.created_at
    from rw_messages m
    join rw_channels c on c.id = m.channel_id
    join rw_users   u on u.id = m.sender_id
    where m.deleted_at is null
      -- websearch_to_tsquery parses what a person actually types, including quoted
      -- phrases and "or". It never raises on malformed input, unlike to_tsquery.
      and m.search_vector @@ websearch_to_tsquery('rw_spanish', p_term)
      -- Keyset pagination. The row comparison is a single index friendly predicate;
      -- OFFSET is forbidden by the assessment and would also skip or repeat rows when
      -- someone posts while the user is paging.
      and (
          p_after_created_at is null
          or (m.created_at, m.id) < (p_after_created_at, coalesce(p_after_id, 9223372036854775807))
      )
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

comment on function rw_search_messages(text, integer, timestamptz, bigint) is
    'Full text search over the messages the actor can read, with the term highlighted.';

grant execute on all routines in schema public to rw_app;

-- Required query 2: message search with the matched term highlighted.
--
-- This is the body of rw_search_messages, kept here as a standalone, runnable query.
-- The API calls the function; this file is the documentation of what it does.
--
-- Parameters
--   $1 search term, as typed by the user
--   $2 page size
--   $3 cursor timestamp, null on the first page
--   $4 cursor id,        null on the first page

select
    m.id as message_id,
    c.name as channel_name,
    u.full_name as sender_name,
    -- The highlight the assessment asks for. ts_headline re-runs the parser over the
    -- original text and wraps the lexemes the query matched, so a search for
    -- "paginacion" also marks "paginación" and "paginaciones".
    ts_headline(
        'rw_spanish',
        m.body,
        websearch_to_tsquery('rw_spanish', $1),
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=30'
    ) as headline,
    m.created_at
from rw_messages m
join rw_channels c on c.id = m.channel_id
join rw_users   u on u.id = m.sender_id
where m.deleted_at is null
  -- The @@ operator against the stored tsvector is what the GIN index answers.
  -- websearch_to_tsquery parses what a person actually types ("quoted phrase", or, -not)
  -- and never raises on malformed input, unlike to_tsquery.
  and m.search_vector @@ websearch_to_tsquery('rw_spanish', $1)
  and ($3::timestamptz is null or (m.created_at, m.id) < ($3::timestamptz, $4::bigint))
order by m.created_at desc, m.id desc
limit $2;

-- Plan note
-- ---------
-- At the seeded corpus size the planner uses a Seq Scan, which is correct for 50 rows.
-- At volume the @@ predicate is answered by a Bitmap Index Scan on
-- rw_messages_search_vector_idx followed by a Bitmap Heap Scan.
--
-- ts_headline sits in the SELECT list and not in the WHERE clause on purpose: it re-runs
-- the text parser over the full body, so it must only touch the rows that survive to the
-- LIMIT, never the whole table.
--
-- The result carries the message text verbatim between the <mark> markers, so the
-- frontend splits on them and renders the pieces as text. It never sets innerHTML.
--
-- Security: no filter on channel membership appears anywhere in this query, and none is
-- needed. rw_messages_select_member already restricts the rows to channels the actor
-- belongs to. Searching cannot reach further than reading.

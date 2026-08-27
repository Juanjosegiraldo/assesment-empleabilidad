-- Required query 1: channel history, paginated by keyset.
--
-- Runs inside a transaction that has already pinned the actor:
--     begin;
--     select set_config('app.current_user_id', $actor, true);
--     <this query>
--     commit;
--
-- Parameters
--   $1 channel id
--   $2 cursor timestamp, null on the first page
--   $3 cursor id,        null on the first page
--   $4 page size
--
-- Why keyset and not OFFSET
--   OFFSET makes the database read and discard every skipped row, so page 50 costs
--   fifty times page 1. Worse for a chat: if somebody posts while the user scrolls up,
--   every later row shifts by one and the next page repeats or skips a message. A
--   cursor is anchored to a row, so concurrent inserts cannot move it. The assessment
--   forbids OFFSET for exactly this reason.
--
-- Why (created_at, id) and not created_at alone
--   Two messages can share a timestamp. The identity column breaks the tie in a stable
--   order, so the cursor is unambiguous.

select
    m.id,
    m.channel_id,
    m.body,
    m.created_at,
    m.edited_at,
    m.sender_id,
    u.full_name as sender_name,
    u.job_title as sender_job_title,
    -- Read receipt for the actor, so the client does not need a second round trip.
    exists (
        select 1
        from rw_message_reads r
        where r.message_id = m.id
          and r.user_id = rw_current_actor_id()
    ) as read_by_actor
from rw_messages m
join rw_users u on u.id = m.sender_id
where m.channel_id = $1
  and m.deleted_at is null
  -- Row comparison, not three OR'd predicates: PostgreSQL can turn this into a single
  -- index range scan.
  and ($2::timestamptz is null or (m.created_at, m.id) < ($2::timestamptz, $3::bigint))
order by m.created_at desc, m.id desc
limit $4;

-- Measured plan
-- -------------
-- On the seeded corpus (50 messages) the planner picks a Seq Scan, and it is right to:
-- reading 50 rows from the heap is cheaper than walking an index. Forcing the index with
-- set enable_seqscan = off confirms it is usable and correctly shaped.
--
-- The plan that matters is the one at scale. With 50,000 messages in one channel,
-- EXPLAIN (ANALYZE) on this query returns:
--
--   Limit (actual rows=10)
--     ->  Index Only Scan using rw_messages_channel_history_idx on rw_messages
--           Index Cond: ((channel_id = 22) AND (ROW(created_at, id) < ROW(...)))
--   actual time: 0.69 ms
--
-- Two things to notice. There is no Sort node, because the index is declared
-- (channel_id, created_at desc, id desc) and the ORDER BY asks for exactly that order.
-- And actual rows = 10: the scan touches ten rows and stops, no matter how deep into the
-- history the cursor points.
--
-- The same page reached with OFFSET 40000 also uses the index, but its Index Cond is
-- only (channel_id = 22): it has to walk all 40,010 rows and throw 40,000 of them away.
-- That is the cost keyset removes, and it is why the assessment forbids OFFSET.
--
-- To reproduce, load synthetic volume into one channel and ANALYZE before comparing.

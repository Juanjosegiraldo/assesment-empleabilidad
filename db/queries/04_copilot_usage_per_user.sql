-- Required query 4: accumulated copilot consumption per user.
--
-- One row per user with their totals. rw_copilot_usage records one row per copilot call,
-- and total_tokens is a stored generated column, so the sum never recomputes it.
--
-- Parameters
--   $1 start of the window (timestamptz), null for all time
--   $2 end of the window   (timestamptz), null for all time

select
    u.id as user_id,
    u.full_name,
    u.job_title,
    count(*) as call_count,
    sum(usage.prompt_tokens) as prompt_tokens,
    sum(usage.completion_tokens) as completion_tokens,
    sum(usage.total_tokens) as total_tokens,
    -- Rounded so the report reads as a number, not as a float artefact.
    round(avg(usage.total_tokens), 1) as avg_tokens_per_call,
    min(usage.created_at) as first_call_at,
    max(usage.created_at) as last_call_at
from rw_copilot_usage usage
join rw_users u on u.id = usage.user_id
where ($1::timestamptz is null or usage.created_at >= $1::timestamptz)
  and ($2::timestamptz is null or usage.created_at <  $2::timestamptz)
group by u.id, u.full_name, u.job_title
order by total_tokens desc;

-- Expected plan: Index Scan on rw_copilot_usage_user_idx (user_id, created_at desc)
-- feeding a GroupAggregate. The index covers both the time window and the grouping key.
--
-- Note the RLS consequence: run by the API as a normal user, this returns exactly one
-- row, their own, because rw_copilot_usage_select_own restricts it. The full company
-- report is an administrative query, run through the owner connection.

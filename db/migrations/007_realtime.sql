-- Real time delivery.
--
-- When a message is inserted, PostgreSQL tells the API through NOTIFY, the API pushes it
-- to the browsers listening on that channel, and nobody polls anything.
--
-- Two properties of NOTIFY make this trustworthy:
--
--   * notifications are delivered at COMMIT, not at the moment pg_notify runs. A message
--     inserted inside a transaction that later rolls back is never announced, so a
--     browser can never show a message that does not exist.
--   * the payload is capped at 8000 bytes, which is a useful constraint rather than a
--     limitation. See below.

create or replace function rw_tg_notify_message()
    returns trigger
    language plpgsql
as $$
begin
    -- Only identifiers travel in the payload, never the message body.
    --
    -- This is a security decision, not a size one. The API has a single connection
    -- listening for every channel in the company; if the body rode along, that process
    -- would hold content it must not hand to the wrong subscriber, and correctness would
    -- depend on the dispatch code filtering it right.
    --
    -- Sending only ids means each subscriber's connection re-reads the message as its own
    -- actor, so row level security decides again, per person, at delivery time. A user
    -- removed from a channel between subscribing and now simply gets nothing.
    perform pg_notify(
        'rw_message_created',
        json_build_object('message_id', new.id, 'channel_id', new.channel_id)::text
    );
    return null;  -- AFTER trigger: the return value is ignored
end;
$$;

comment on function rw_tg_notify_message() is
    'Announces a new message by id. The payload never carries content.';

drop trigger if exists rw_messages_notify_tg on rw_messages;
create trigger rw_messages_notify_tg
    after insert on rw_messages
    for each row
    execute function rw_tg_notify_message();

-- Base schema for the Riwi messaging platform.
--
-- Conventions required by the assessment and applied everywhere below:
--   * every table and column name is English and prefixed with rw_
--   * every timestamp is timestamptz, stored in UTC
--   * rows are never physically deleted, they are marked with deleted_at
--   * every foreign key declares an explicit ON DELETE, justified in a "why" comment
--
-- The model behind this file is documented in docs/ERD.md.
-- The search_vector column and its trigger arrive later, in 004_search.sql.

-- pgvector stores the message embeddings used by the copilot. Keeping them in this
-- database rather than in an external vector store means retrieval is an ordinary
-- query, and therefore subject to the same row level security as reading a message.
create extension if not exists vector;


-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
create table if not exists rw_users (
    id            bigint generated always as identity primary key,
    email         text        not null,
    password_hash text        not null,
    full_name     text        not null,
    job_title     text        not null,
    locale        text        not null default 'es',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    deleted_at    timestamptz,

    constraint rw_users_email_format_check
        check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    constraint rw_users_full_name_not_blank_check
        check (length(btrim(full_name)) > 0),
    constraint rw_users_job_title_not_blank_check
        check (length(btrim(job_title)) > 0),
    constraint rw_users_locale_check
        check (locale in ('es', 'en')),
    -- Storing a plain text password invalidates the assessment. This constraint makes
    -- it physically impossible: the value has to look like a bcrypt digest ($2a/$2b/$2y)
    -- or the INSERT is rejected by the database, not by the application.
    constraint rw_users_password_is_hashed_check
        check (password_hash ~ '^\$2[aby]\$\d{2}\$'),
    constraint rw_users_deleted_after_created_check
        check (deleted_at is null or deleted_at >= created_at)
);

-- Required partial unique index: an email is unique among *active* users only, so a
-- deactivated account frees its address for reuse. lower() makes the rule case
-- insensitive without pulling in the citext extension.
create unique index if not exists rw_users_active_email_uidx
    on rw_users (lower(email))
    where deleted_at is null;


-- -----------------------------------------------------------------------------
-- Channels
-- -----------------------------------------------------------------------------
create table if not exists rw_channels (
    id          bigint generated always as identity primary key,
    slug        text        not null,
    name        text        not null,
    topic       text,
    is_private  boolean     not null default false,
    -- why RESTRICT: who opened a channel is business information. Users are
    -- deactivated with deleted_at, never removed, so this should never fire.
    created_by  bigint      not null references rw_users (id) on delete restrict,
    created_at  timestamptz not null default now(),
    archived_at timestamptz,

    -- Required plain UNIQUE constraint. The slug is the stable public handle of a
    -- channel, so it stays unique even after archiving.
    constraint rw_channels_slug_unique unique (slug),
    constraint rw_channels_slug_format_check
        check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
    constraint rw_channels_name_not_blank_check
        check (length(btrim(name)) > 0)
);


-- -----------------------------------------------------------------------------
-- Channel membership (associative entity resolving users N:M channels)
-- -----------------------------------------------------------------------------
create table if not exists rw_channel_members (
    -- why CASCADE: a membership carries no information of its own. Without its
    -- channel or its user it is orphan noise, not evidence.
    channel_id  bigint      not null references rw_channels (id) on delete cascade,
    user_id     bigint      not null references rw_users (id)    on delete cascade,
    member_role text        not null default 'member',
    joined_at   timestamptz not null default now(),
    left_at     timestamptz,

    -- Composite natural key: uniqueness of the membership is guaranteed by
    -- construction, and this index is exactly the lookup every RLS policy performs.
    primary key (channel_id, user_id),

    constraint rw_channel_members_role_check
        check (member_role in ('owner', 'member')),
    constraint rw_channel_members_left_after_joined_check
        check (left_at is null or left_at >= joined_at)
);

-- The primary key answers "who belongs to this channel". This index answers the
-- reverse question, "which channels does this user belong to", which is what the
-- conversation list and the copilot retrieval need.
create index if not exists rw_channel_members_active_user_idx
    on rw_channel_members (user_id, channel_id)
    where left_at is null;


-- -----------------------------------------------------------------------------
-- Messages
-- -----------------------------------------------------------------------------
create table if not exists rw_messages (
    id         bigint generated always as identity primary key,
    -- why RESTRICT: deleting a channel must never silently destroy its conversation.
    -- Channels are archived with archived_at instead.
    channel_id bigint      not null references rw_channels (id) on delete restrict,
    -- why RESTRICT: authorship has to stay attributable.
    sender_id  bigint      not null references rw_users (id)    on delete restrict,
    body       text        not null,
    created_at timestamptz not null default now(),
    edited_at  timestamptz,
    deleted_at timestamptz,

    constraint rw_messages_body_not_blank_check
        check (length(btrim(body)) > 0),
    constraint rw_messages_body_length_check
        check (length(body) <= 4000),
    constraint rw_messages_edited_after_created_check
        check (edited_at is null or edited_at >= created_at),
    constraint rw_messages_deleted_after_created_check
        check (deleted_at is null or deleted_at >= created_at)
);

-- Supports the keyset pagination of the channel history:
--   ... where channel_id = $1 and (created_at, id) < ($2, $3)
--       order by created_at desc, id desc limit $4
-- The column order matches the ORDER BY exactly, so PostgreSQL walks the index
-- backwards and stops at LIMIT instead of sorting. Partial on deleted_at is null
-- because deleted messages are never listed.
create index if not exists rw_messages_channel_history_idx
    on rw_messages (channel_id, created_at desc, id desc)
    where deleted_at is null;


-- -----------------------------------------------------------------------------
-- Message revisions
--
-- The assessment requires that editing a message preserves its original state.
-- rw_edit_message writes here in the same transaction as the UPDATE, so an edit is
-- either fully recorded or not applied at all.
-- -----------------------------------------------------------------------------
create table if not exists rw_message_revisions (
    id            bigint generated always as identity primary key,
    -- why CASCADE: a revision is a weak entity, a part of its message.
    message_id    bigint      not null references rw_messages (id) on delete cascade,
    previous_body text        not null,
    -- why RESTRICT: an audit trail has to keep pointing at a real actor.
    revised_by    bigint      not null references rw_users (id)    on delete restrict,
    revised_at    timestamptz not null default now()
);

create index if not exists rw_message_revisions_message_idx
    on rw_message_revisions (message_id, revised_at desc);


-- -----------------------------------------------------------------------------
-- Read states (associative entity resolving users N:M messages)
-- -----------------------------------------------------------------------------
create table if not exists rw_message_reads (
    -- why CASCADE on both: a read receipt for a row that no longer exists is noise.
    message_id bigint      not null references rw_messages (id) on delete cascade,
    user_id    bigint      not null references rw_users (id)    on delete cascade,
    read_at    timestamptz not null default now(),

    primary key (message_id, user_id)
);

-- Unread counts scan by reader, not by message.
create index if not exists rw_message_reads_user_idx
    on rw_message_reads (user_id, message_id);


-- -----------------------------------------------------------------------------
-- Message embeddings (vector store for the copilot)
-- -----------------------------------------------------------------------------
create table if not exists rw_message_embeddings (
    -- Identifying key: the primary key is also the foreign key. An embedding is not
    -- an independent entity, so the shared key enforces the 1:1 relationship without
    -- an extra unique constraint.
    -- why CASCADE: derived data, fully rebuildable by rerunning the indexer.
    message_id bigint      primary key references rw_messages (id) on delete cascade,
    embedding  vector(1024) not null,   -- nvidia/nv-embedqa-e5-v5 output size
    model      text        not null,     -- which model produced it, so we can reindex
    created_at timestamptz not null default now()
);

-- HNSW with cosine distance, matching the <=> operator used by the retrieval query.
-- HNSW over IVFFlat because it does not need a training step on an already populated
-- table, which matters when the corpus is loaded and indexed in one pass.
create index if not exists rw_message_embeddings_cosine_idx
    on rw_message_embeddings using hnsw (embedding vector_cosine_ops);


-- -----------------------------------------------------------------------------
-- Refresh tokens
--
-- Only the hash is stored: a database dump does not hand out live sessions.
-- rotated_from_id chains each token to the one it replaced, which is what makes
-- reuse detection possible in the refresh endpoint.
-- -----------------------------------------------------------------------------
create table if not exists rw_refresh_tokens (
    id              bigint generated always as identity primary key,
    -- why CASCADE: a session belongs to its user and must not outlive the account.
    user_id         bigint      not null references rw_users (id) on delete cascade,
    token_hash      text        not null,
    -- why SET NULL: self reference. Pruning an old token must not break the chain
    -- that is still active.
    rotated_from_id bigint      references rw_refresh_tokens (id) on delete set null,
    issued_at       timestamptz not null default now(),
    expires_at      timestamptz not null,
    revoked_at      timestamptz,

    constraint rw_refresh_tokens_hash_unique unique (token_hash),
    constraint rw_refresh_tokens_expiry_check check (expires_at > issued_at)
);

create index if not exists rw_refresh_tokens_active_idx
    on rw_refresh_tokens (user_id)
    where revoked_at is null;


-- -----------------------------------------------------------------------------
-- Copilot consumption
--
-- One row per copilot call. Feeds the required "accumulated copilot usage per user"
-- query, and records which prompt version produced each answer.
-- -----------------------------------------------------------------------------
create table if not exists rw_copilot_usage (
    id                bigint generated always as identity primary key,
    -- why RESTRICT: consumption is an accounting record, it outlives the account.
    user_id           bigint      not null references rw_users (id) on delete restrict,
    model             text        not null,
    prompt_version    text        not null,
    prompt_tokens     integer     not null default 0,
    completion_tokens integer     not null default 0,
    -- Derived and stored, so the aggregation query never recomputes it.
    total_tokens      integer generated always as (prompt_tokens + completion_tokens) stored,
    created_at        timestamptz not null default now(),

    constraint rw_copilot_usage_tokens_check
        check (prompt_tokens >= 0 and completion_tokens >= 0)
);

create index if not exists rw_copilot_usage_user_idx
    on rw_copilot_usage (user_id, created_at desc);


-- -----------------------------------------------------------------------------
-- Privileges for the application role
--
-- Note what is missing: DELETE and TRUNCATE are never granted. The ban on physical
-- deletes is not a convention the developer has to remember, it is a privilege the
-- API simply does not hold.
-- -----------------------------------------------------------------------------
grant usage on schema public to rw_app;

grant select, insert, update on all tables in schema public to rw_app;

-- Identity columns do not require sequence privileges, but the seed loader and future
-- objects may, and USAGE alone cannot be used to bypass anything.
grant usage on all sequences in schema public to rw_app;

-- Same rules for objects created by later migrations.
alter default privileges in schema public
    grant select, insert, update on tables to rw_app;
alter default privileges in schema public
    grant usage on sequences to rw_app;

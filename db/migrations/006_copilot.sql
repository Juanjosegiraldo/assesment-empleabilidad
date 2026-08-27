-- Copilot retrieval.

-- -----------------------------------------------------------------------------
-- Dimension correction for databases created before the embedding model was chosen
--
-- Embeddings are derived data: the indexer rebuilds all of them from the message bodies
-- in a couple of minutes. So changing the dimension is a truncate and reindex, not a
-- data migration, and this block is safe to rerun.
-- -----------------------------------------------------------------------------
do $$
declare
    current_type text;
begin
    select format_type(atttypid, atttypmod)
    into current_type
    from pg_attribute
    where attrelid = 'rw_message_embeddings'::regclass
      and attname = 'embedding';

    if current_type <> 'vector(768)' then
        truncate rw_message_embeddings;
        alter table rw_message_embeddings alter column embedding type vector(768);
        raise notice 'rw_message_embeddings.embedding resized from % to vector(768)', current_type;
    end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- rw_copilot_context
--
-- The retrieval half of the RAG pipeline, and the reason the copilot cannot leak.
--
-- There is no permission check in this function. There does not need to be one. It is an
-- ordinary SELECT, so the policies on rw_message_embeddings and rw_messages apply, and
-- the actor can only reach passages from channels they belong to.
--
-- SECURITY INVOKER is stated explicitly. Turning it into a definer function would make
-- the copilot omniscient in one word, which is exactly the mistake this design exists to
-- prevent.
-- -----------------------------------------------------------------------------
create or replace function rw_copilot_context(
    p_embedding vector(768),
    p_limit     integer default 8
)
    returns table (
        message_id       bigint,
        body             text,
        created_at       timestamptz,
        channel_name     text,
        author_name      text,
        author_job_title text,
        distance         double precision
    )
    language sql
    stable
    security invoker
as $$
    select
        m.id,
        m.body,
        m.created_at,
        c.name,
        u.full_name,
        u.job_title,
        -- Cosine distance: 0 identical, 1 unrelated, 2 opposite. Returned so the
        -- application can drop weak matches instead of feeding the model noise.
        (e.embedding <=> p_embedding)::double precision
    from rw_message_embeddings e
    join rw_messages m on m.id = e.message_id
    join rw_channels c on c.id = m.channel_id
    join rw_users   u on u.id = m.sender_id
    where m.deleted_at is null
    -- The operator has to be the same one the HNSW index was built with
    -- (vector_cosine_ops), otherwise PostgreSQL falls back to a sequential scan and
    -- reranks in memory.
    order by e.embedding <=> p_embedding
    limit least(greatest(coalesce(p_limit, 8), 1), 30);
$$;

comment on function rw_copilot_context(vector, integer) is
    'Nearest message passages the current actor is allowed to read. Invoker rights, so RLS applies.';

grant execute on all routines in schema public to rw_app;

-- Required query 3: context retrieval for the copilot, with permissions enforced in SQL.
--
-- This is the retrieval half of the RAG pipeline. The API embeds the user's question,
-- passes the vector in as $1, and hands the rows it gets back to the model as context.
--
-- Parameters
--   $1 the question embedding, vector(1024)
--   $2 how many passages to retrieve
--
-- The security argument, which is the point of the whole design:
--
--   There is no permission check in this query. There does not need to be one. Retrieval
--   is an ordinary SELECT over rw_message_embeddings and rw_messages, so both RLS
--   policies apply: the actor can only reach embeddings whose message lives in a channel
--   they are a member of.
--
--   That is why the vectors are stored in PostgreSQL instead of an external vector
--   database. With a separate store the permission model would have to be reimplemented
--   and kept in sync on the retrieval path, and that is where copilots leak.
--
--   The consequence is worth stating plainly: two users asking the identical question
--   get context built from different rows, without a single line of application code
--   deciding that.

select
    m.id as message_id,
    m.body,
    m.created_at,
    c.name as channel_name,
    u.full_name as author_name,
    u.job_title as author_job_title,
    -- Cosine distance: 0 is identical, 2 is opposite. Returned so the API can drop
    -- passages that are only weakly related instead of feeding the model noise.
    (e.embedding <=> $1::vector) as distance
from rw_message_embeddings e
join rw_messages m on m.id = e.message_id
join rw_channels c on c.id = m.channel_id
join rw_users   u on u.id = m.sender_id
where m.deleted_at is null
order by e.embedding <=> $1::vector
limit $2;

-- Expected plan: Index Scan using rw_message_embeddings_cosine_idx.
-- The <=> in the ORDER BY has to be the same operator the index was built with
-- (vector_cosine_ops), otherwise PostgreSQL silently falls back to a sequential scan
-- and reranks everything in memory.

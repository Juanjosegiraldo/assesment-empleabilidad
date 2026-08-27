import { Router, type RequestHandler } from "express";
import { askCopilot } from "../../../application/copilot/askCopilot.js";
import { withActor } from "../../../infrastructure/db/withActor.js";
import { PostgresCopilotContextRepository } from "../../../infrastructure/repositories/PostgresCopilotContextRepository.js";
import type { ChatProvider } from "../../../domain/ports/ChatProvider.js";
import type { EmbeddingProvider } from "../../../domain/ports/EmbeddingProvider.js";

export type CopilotDependencies = {
  embeddings: EmbeddingProvider;
  chat: ChatProvider;
  requireAuth: RequestHandler;
};

export function buildCopilotRouter(deps: CopilotDependencies): Router {
  const router = Router();
  router.use(deps.requireAuth);

  router.post("/copilot/ask", async (req, res) => {
    // The actor comes from the verified token. Name and job title go into the system
    // prompt from here, on the server, so the request body cannot tell the assistant who
    // it is talking to.
    const actor = {
      fullName: req.actor.fullName,
      jobTitle: req.actor.jobTitle,
      locale: req.actor.locale,
    };

    const answer = await withActor(req.actor.userId, (client) =>
      askCopilot(
        {
          embeddings: deps.embeddings,
          chat: deps.chat,
          context: new PostgresCopilotContextRepository(client),
        },
        { question: req.body?.question, actor },
      ),
    );

    res.json(answer);
  });

  /** The actor's own copilot consumption. RLS makes "own" the only possibility. */
  router.get("/copilot/usage", async (req, res) => {
    const usage = await withActor(req.actor.userId, async (client) => {
      const result = await client.query(
        `select count(*)::int as call_count,
                coalesce(sum(prompt_tokens), 0)::int as prompt_tokens,
                coalesce(sum(completion_tokens), 0)::int as completion_tokens,
                coalesce(sum(total_tokens), 0)::int as total_tokens
         from rw_copilot_usage`,
      );
      return result.rows[0];
    });

    res.json(usage);
  });

  return router;
}

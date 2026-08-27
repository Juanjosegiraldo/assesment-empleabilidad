import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { parse } from "yaml";

/** Looks for a path in each ancestor directory, starting at `from`. */
function findUpwards(relative: string, from: string): string {
  let directory = from;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = resolve(directory, relative);
    if (existsSync(candidate)) return candidate;
    directory = resolve(directory, "..");
  }
  throw new Error(`Could not find ${relative} above ${from}`);
}

/**
 * Serves the OpenAPI document and a browsable UI at /docs.
 *
 * The spec is hand written in docs/openapi.yaml rather than generated from decorators.
 * Generated specs describe the shape of a response and stop there; this one has to
 * explain why an unreadable channel answers 200 with an empty list instead of 403, which
 * no annotation can say.
 *
 * It is read once at boot. A failure to parse it should stop the process, not surface as
 * a broken page nobody visits until the reviewer does.
 */
export function buildDocsRouter(): Router {
  const router = Router();

  // Walk up from this file to the repository root rather than counting "../" by hand,
  // which is easy to get wrong and stays correct whether running from src or dist.
  const specPath = findUpwards("docs/openapi.yaml", import.meta.dirname);
  const spec = parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;

  router.get("/openapi.yaml", (_req, res) => {
    res.type("text/yaml").send(readFileSync(specPath, "utf8"));
  });

  router.use("/docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "Riwi Messaging API" }));

  return router;
}

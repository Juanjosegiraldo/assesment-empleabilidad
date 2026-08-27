import express, { type Express } from "express";
import { correlationId } from "./middleware/correlationId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { config } from "../../config.js";

/**
 * Builds the Express application.
 *
 * Kept separate from main.ts so tests can mount the app without opening a port.
 *
 * Express 5 forwards a rejected promise from a handler to the error middleware on its
 * own, which is why no route in this codebase wraps its body in try/catch.
 */
export function createServer(): Express {
  const app = express();

  app.use(correlationId);
  app.use(express.json({ limit: "64kb" }));

  // The browser sends the refresh token as a cookie, so the response has to allow
  // credentials and the origin cannot be a wildcard.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-correlation-id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(healthRouter);

  // Order matters: the catch all 404 goes after every route, the error handler last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

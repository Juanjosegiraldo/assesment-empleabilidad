import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The tests share one real database. Running them in parallel would have them
    // reading each other's state, so they run one file at a time.
    fileParallelism: false,
    // A cold bcrypt verify plus a round trip is slower than the 5s default on first run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

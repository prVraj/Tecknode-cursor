import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.integration.test.ts",
      "test/**/*.test.ts",
    ],
    exclude: ["**/*.e2e.test.ts", "node_modules/**"],
    // Some modules build their config at import time — `src/env/server.ts`
    // validates the whole env, and db clients construct at import. These env
    // env values only let the modules load; tests mock their own dependencies.
    env: {
      SKIP_ENV_VALIDATION: "true",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "server-only": resolve(__dirname, "./test/shims/server-only.ts"),
    },
  },
});

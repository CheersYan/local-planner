import path from "path";
import { defineConfig } from "vitest/config";

const databaseUrl = `file:${path.join(__dirname, "prisma", "dev.db")}`;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/components/ai/**/?(*.)dom.test.tsx", "jsdom"]],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    env: {
      DATABASE_URL: databaseUrl,
      RUN_OPENAI_ROUTE_TEST: "0",
    },
  },
});

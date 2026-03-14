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
    env: {
      DATABASE_URL: databaseUrl,
    },
  },
});

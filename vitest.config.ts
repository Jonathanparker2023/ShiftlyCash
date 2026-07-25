import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Agent worktrees under .claude/ are full checkouts of this repo. Without
    // this, every test file gets collected twice — once here and once from a
    // detached copy whose "@" alias points at the wrong src — so the suite
    // reports failures that have nothing to do with the working tree.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
  },
});

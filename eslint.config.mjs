import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".vercel/**", ".worktrees/**", "artifacts/**", "coverage/**", "loopforge/**", "supabase/.temp/**", "next-env.d.ts"]),
]);

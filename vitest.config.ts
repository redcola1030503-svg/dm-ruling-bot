import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // git worktree(scripts/codex-review.ps1等が作業ツリー分離に使う)が
    // ルート直下に作られると、そのサブディレクトリのtests/も拾ってテストが
    // 二重実行されてしまう(T002 P2-2)。デフォルトのexcludeに追加する形で除外する。
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "**/.worktrees/**",
    ],
  },
});

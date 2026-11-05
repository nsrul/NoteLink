import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { jazzPlugin } from "jazz-tools/dev/vite";
import { defineConfig, loadEnv } from "vite";

const jazzDir = fileURLToPath(new URL("./src/jazz", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const testing = mode === "test" || Boolean(process.env.VITEST);
  const cloud = !testing && command === "serve" && env.VITE_JAZZ_APP_ID && env.VITE_JAZZ_SERVER_URL && env.JAZZ_ADMIN_SECRET;
  return {
    base: "./",
    plugins: [
      react(),
      jazzPlugin({
        schemaDir: jazzDir,
        server: cloud ? env.VITE_JAZZ_SERVER_URL : false,
        ...(env.VITE_JAZZ_APP_ID ? { appId: env.VITE_JAZZ_APP_ID } : {}),
        ...(env.JAZZ_ADMIN_SECRET ? { adminSecret: env.JAZZ_ADMIN_SECRET } : {}),
      }),
    ],
  };
});

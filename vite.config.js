import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Only these two values are allowed into the browser bundle.
// The service-role key, cron secret, and API keys must never be listed here.
function pick(name, fileEnv) {
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.length > 0) return fromProcess;
  const fromFile = fileEnv[name];
  if (typeof fromFile === "string" && fromFile.length > 0) return fromFile;
  return "";
}

export default defineConfig(({ mode }) => {
  // Read VITE_ and CONFIG_ names from .env files. Anything else in those files
  // stays on the server. process.env wins, which is how Vercel injects them.
  const fileEnv = loadEnv(mode, process.cwd(), ["VITE_", "CONFIG_"]);
  const supabaseUrl = pick("VITE_SUPABASE_URL", fileEnv) || pick("CONFIG_SUPABASE_URL", fileEnv);
  const supabaseAnonKey = pick("VITE_SUPABASE_ANON_KEY", fileEnv) || pick("CONFIG_SUPABASE_ANON_KEY", fileEnv);

  return {
    plugins: [react()],
    // A prefix nothing uses, so Vite does not copy every VITE_ or CONFIG_ variable
    // into the client. The two Supabase values are injected explicitly below.
    envPrefix: "ALPHASCREEN_UNPREFIXED_",
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
    },
  };
});

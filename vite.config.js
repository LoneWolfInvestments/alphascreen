import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // By default Vite only exposes env vars prefixed VITE_ to client-side code.
  // Also allow CONFIG_ since Vercel's UI pushed the Supabase URL variable into that naming.
  envPrefix: ["VITE_", "CONFIG_"],
});

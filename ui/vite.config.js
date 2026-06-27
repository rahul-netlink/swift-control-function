import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        host: true, // listen on 0.0.0.0 so the container is reachable from the host
        port: 5173,
        strictPort: true,
    },
});

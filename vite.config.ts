import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // 排除对 Tauri 编译目录的监控，防止 EBUSY 文件占用报错
      ignored: ["**/src-tauri/target/**"],
    },
  },
});

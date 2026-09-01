import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://sectorvault.example.com',
  vite: {
    plugins: [
      tailwindcss(),
      {
        // 官方 preload-helper 使用 import.meta.resolve，happy-dom 无法编译；
        // 换成透传实现（预加载仅是优化，省略不影响功能）
        name: 'svp-simple-preload-helper',
        enforce: 'pre',
        load(id) {
          if (id === '\0vite/preload-helper.js') {
            return 'export const __vitePreload = (loader) => loader();';
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // @gitee/typescript-sdk-v5 生成代码需要的共享 client 实例由垫片提供
        '@hey-api/client-axios': fileURLToPath(
          new URL('./src/lib/adapters/hey-api-client-axios-shim.ts', import.meta.url),
        ),
      },
    },
  },
});

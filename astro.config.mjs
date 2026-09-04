import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// site/base 经环境变量注入（Pages 子路径部署见 .github/workflows/deploy-pages.yml）
export default defineConfig({
  site: process.env.ASTRO_SITE ?? 'https://sectorvault.example.com',
  base: process.env.ASTRO_BASE || undefined,
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
      },
    },
  },
});

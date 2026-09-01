/**
 * @hey-api/client-axios 垫片（通过 vite alias 注入）：
 * @gitee/typescript-sdk-v5 的生成代码 `import { client } from '@hey-api/client-axios'`，
 * 但已发布的 client-axios 版本均未导出共享实例，仅提供 createClient。
 * 这里补上指向 Gitee OpenAPI v5 的默认 client，其余导出原样透传。
 * 注意：必须通过相对路径引用真实包，避免与 alias 形成循环。
 */
import { createClient } from '../../../node_modules/@hey-api/client-axios/dist/index.js';

export * from '../../../node_modules/@hey-api/client-axios/dist/index.js';

export const client = createClient({
  baseURL: 'https://gitee.com/api',
});

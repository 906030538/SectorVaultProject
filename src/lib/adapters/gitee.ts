import { V5PlatformAdapter } from './atomgit';
import type { GitPlatformAdapter } from './types';

/**
 * Gitee 适配器：OpenAPI v5（https://gitee.com/api/v5）。
 * 与 v5 系平台（AtomGit/GitCode）同构，复用 V5PlatformAdapter；
 * 覆写 Gitee 特有的 release 附件接口（attach_files，按 releaseId 寻址）。
 * 说明：官方 SDK（@gitee/typescript-sdk-v5）经 hey-api client-axios 会把
 * 路径参数中的 "/" 编码为 %2F 导致 404，故改用直连 fetch 实现。
 */
export class GiteeAdapter extends V5PlatformAdapter implements GitPlatformAdapter {
  constructor() {
    super({
      platform: 'gitee',
      apiBase: 'https://gitee.com/api/v5',
      webBase: 'https://gitee.com',
    });
  }

  override async uploadReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    file: Blob,
    name: string,
  ): Promise<void> {
    const form = new FormData();
    form.append('file', file, name);
    const response = await fetch(
      `${this.apiBase}/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases/${releaseId}/attach_files`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    );
    if (!response.ok) {
      throw new Error(`Upload release asset failed: ${response.status}`);
    }
  }

  override async deleteReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    assetId: number,
  ): Promise<void> {
    await this.request(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases/${releaseId}/attach_files/${assetId}`,
      { method: 'DELETE', token },
    );
  }
}

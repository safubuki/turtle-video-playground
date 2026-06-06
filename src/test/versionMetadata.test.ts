import { describe, expect, it } from 'vitest';
import versionData from '../../version.json';

describe('version metadata', () => {
  it('v5.2.0 の現在バージョンと iOS Safari success baseline の変更概要を持つ', () => {
    expect(versionData.version).toBe('5.2.0');
    expect(versionData.history.previousVersion).toBe('5.1.18');
    expect(versionData.history.summary).toContain('iOS Safari');
    expect(versionData.history.summary).toContain('緑のダウンロードボタン');
    expect(versionData.history.summary).toContain('Docs/2026-05-26_success_ios-safari-preview-export.md');
    expect(versionData.history.highlights).toHaveLength(4);
    expect(versionData.history.highlights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'iOS Safari preview/export success baseline',
        }),
        expect.objectContaining({
          title: 'Main export recorderRef wiring',
        }),
        expect.objectContaining({
          title: 'Confirmed-download-only UI transition',
        }),
        expect.objectContaining({
          title: 'Docs classification and recovery memo',
        }),
      ]),
    );
  });
});

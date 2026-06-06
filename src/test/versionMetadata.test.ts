import { describe, expect, it } from 'vitest';
import versionData from '../../version.json';

describe('version metadata', () => {
  it('v5.3.0 の現在バージョンと iOS Safari 正式対応の変更概要を持つ', () => {
    expect(versionData.version).toBe('5.3.0');
    expect(versionData.history.previousVersion).toBe('4.1.0');
    expect(versionData.history.summary).toContain('iOS Safari');
    expect(versionData.history.highlights).toHaveLength(6);
    expect(versionData.history.highlights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'iOS Safari 対応' }),
        expect.objectContaining({ title: '端末別の動作最適化' }),
        expect.objectContaining({ title: '書き出し画質の向上' }),
        expect.objectContaining({ title: 'キャプションの WYSIWYG 化' }),
        expect.objectContaining({ title: 'PWA・保存の安定化' }),
        expect.objectContaining({ title: 'プレビュー再生の安定化' }),
      ]),
    );
  });
});

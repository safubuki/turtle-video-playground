import { describe, expect, it } from 'vitest';
import { getSectionHelpContent } from '../constants/sectionHelp';

function getHelpDescription(
  section: keyof ReturnType<typeof getSectionHelpContent>,
  title: string,
  input: Parameters<typeof getSectionHelpContent>[0] = {
    appFlavor: 'standard',
    supportsShowSaveFilePicker: false,
  },
): string {
  const item = getSectionHelpContent(input)[section].items.find((entry) => entry.title === title);
  if (!item) {
    throw new Error(`Help item not found: ${section} / ${title}`);
  }
  return item.description;
}

describe('sectionHelp support messaging', () => {
  it('app help は iPhone Safari を非対応ではなく動作モードとして案内する', () => {
    const description = getHelpDescription('app', '動作確認機種');

    expect(description).toContain('動作モード');
    expect(description).not.toContain('非対応');
  });

  it('保存系ヘルプは保存ダイアログと標準ダウンロードの両方を案内する', () => {
    const pickerNarrationDescription = getHelpDescription('narration', '並び替え・編集・削除・保存', {
      appFlavor: 'standard',
      supportsShowSaveFilePicker: true,
    });
    const fallbackPreviewDescription = getHelpDescription('preview', '作成後のダウンロード', {
      appFlavor: 'standard',
      supportsShowSaveFilePicker: false,
    });

    expect(pickerNarrationDescription).toContain('保存先ダイアログ');
    expect(pickerNarrationDescription).toContain('標準ダウンロード');
    expect(fallbackPreviewDescription).toContain('標準ダウンロード');
  });

  it('apple-safari help は Safari 動作モード向けの案内を出す', () => {
    const appDescription = getHelpDescription('app', '動作確認機種', {
      appFlavor: 'apple-safari',
      supportsShowSaveFilePicker: false,
    });
    const previewDescription = getHelpDescription('preview', '作成後のダウンロード', {
      appFlavor: 'apple-safari',
      supportsShowSaveFilePicker: false,
    });

    expect(appDescription).toContain('安定動作優先の動作モード');
    expect(previewDescription).toContain('共有メニュー');
  });
});

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 元画像のパス
const sourceIcon = path.join(rootDir, 'public', 'turtle_icon.png');

async function generateIcons() {
  // 元画像を読み込み、白い余白をトリミング
  const trimmedImage = await sharp(sourceIcon)
    .trim({ background: '#ffffff', threshold: 10 }) // 白い余白を削除
    .toBuffer();

  // トリミング後の画像サイズを取得
  const metadata = await sharp(trimmedImage).metadata();
  console.log(`Trimmed image size: ${metadata.width}x${metadata.height}`);

  // 丸アイコン対応: コンテンツを70%にして、30%の余白を確保
  // これにより丸くクリップされても文字が切れない
  // 背景は白で統一（透明だとOSによって黒や変な色になる）

  // PWA用アイコン (192x192) - 丸アイコン対応
  await sharp(trimmedImage)
    .resize(134, 134, { fit: 'inside' }) // 192 * 0.7 = 約134
    .extend({
      top: 29, bottom: 29, left: 29, right: 29,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toFile(path.join(rootDir, 'public', 'pwa-192x192.png'));
  console.log('Generated pwa-192x192.png');

  // PWA用アイコン (512x512) - 丸アイコン対応
  await sharp(trimmedImage)
    .resize(358, 358, { fit: 'inside' }) // 512 * 0.7 = 約358
    .extend({
      top: 77, bottom: 77, left: 77, right: 77,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toFile(path.join(rootDir, 'public', 'pwa-512x512.png'));
  console.log('Generated pwa-512x512.png');

  // Apple Touch Icon (180x180) - 丸アイコン対応
  await sharp(trimmedImage)
    .resize(126, 126, { fit: 'inside' }) // 180 * 0.7 = 約126
    .extend({
      top: 27, bottom: 27, left: 27, right: 27,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toFile(path.join(rootDir, 'public', 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png');

  // Favicon用 (32x32) - ブラウザタブは四角なので大きめでOK
  await sharp(trimmedImage)
    .resize(28, 28, { fit: 'inside' })
    .extend({
      top: 2, bottom: 2, left: 2, right: 2,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toFile(path.join(rootDir, 'public', 'favicon-32x32.png'));
  console.log('Generated favicon-32x32.png');

  // Favicon用 (16x16)
  await sharp(trimmedImage)
    .resize(14, 14, { fit: 'inside' })
    .extend({
      top: 1, bottom: 1, left: 1, right: 1,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toFile(path.join(rootDir, 'public', 'favicon-16x16.png'));
  console.log('Generated favicon-16x16.png');
}

generateIcons().catch(console.error);

/* global Buffer, console */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const iconsDir = join(publicDir, 'icons');

// Base SVG icon (512x512 with rounded corners, dark bg, white Px logo)
const baseSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#07070a"/>
  <!-- Large P -->
  <path d="M144 112H272C316.183 112 352 147.817 352 192C352 236.183 316.183 272 272 272H208V352H144V112Z" fill="white"/>
  <path d="M208 160H264C281.673 160 296 174.327 296 192C296 209.673 281.673 224 264 224H208V160Z" fill="#07070a"/>
  <!-- Small x -->
  <path d="M272 304L336 368M336 304L272 368" stroke="white" stroke-width="32" stroke-linecap="round"/>
</svg>
`;

// Maskable icon needs safe-area padding (icon occupies ~80% of canvas)
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#07070a"/>
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <rect width="512" height="512" rx="96" fill="#07070a"/>
    <!-- Large P -->
    <path d="M144 112H272C316.183 112 352 147.817 352 192C352 236.183 316.183 272 272 272H208V352H144V112Z" fill="white"/>
    <path d="M208 160H264C281.673 160 296 174.327 296 192C296 209.673 281.673 224 264 224H208V160Z" fill="#07070a"/>
    <!-- Small x -->
    <path d="M272 304L336 368M336 304L272 368" stroke="white" stroke-width="32" stroke-linecap="round"/>
  </g>
</svg>
`;

const sizes = [
  { name: 'icon-192.png', size: 192, svg: baseSvg },
  { name: 'icon-512.png', size: 512, svg: baseSvg },
  { name: 'icon-maskable-192.png', size: 192, svg: maskableSvg },
  { name: 'icon-maskable-512.png', size: 512, svg: maskableSvg },
  { name: 'apple-touch-icon.png', size: 180, svg: baseSvg },
];

async function generateIcons() {
  await mkdir(iconsDir, { recursive: true });

  for (const { name, size, svg } of sizes) {
    const outputPath = join(iconsDir, name);

    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`Generated: ${name} (${size}x${size})`);
  }

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);

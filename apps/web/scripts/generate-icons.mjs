/* global Buffer, console */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const iconsDir = join(publicDir, 'icons');

// Base SVG icon (32x32 with rounded corners, dark bg, white P logo)
const baseSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#07070a"/>
  <path d="M160 128H296C344.6 128 384 167.4 384 216C384 264.6 344.6 304 296 304H224V384H160V128Z" fill="white"/>
  <path d="M224 184H288C305.7 184 320 198.3 320 216C320 233.7 305.7 248 288 248H224V184Z" fill="#07070a"/>
</svg>
`;

// Maskable icon needs safe-area padding (icon occupies ~80% of canvas)
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#07070a"/>
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <rect width="512" height="512" rx="96" fill="#07070a"/>
    <path d="M160 128H296C344.6 128 384 167.4 384 216C384 264.6 344.6 304 296 304H224V384H160V128Z" fill="white"/>
    <path d="M224 184H288C305.7 184 320 198.3 320 216C320 233.7 305.7 248 288 248H224V184Z" fill="#07070a"/>
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

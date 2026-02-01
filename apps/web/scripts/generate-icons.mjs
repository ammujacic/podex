/* global Buffer, console */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const iconsDir = join(publicDir, 'icons');

// Base SVG icon (512x512 with rounded corners, dark bg, white P{x} logo)
const baseSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#07070a"/>
  <!-- Large P -->
  <path d="M112 80H272C327.228 80 372 124.772 372 180C372 235.228 327.228 280 272 280H192V400H112V80Z" fill="white"/>
  <path d="M192 140H260C282.091 140 300 157.909 300 180C300 202.091 282.091 220 260 220H192V140Z" fill="#07070a"/>
  <!-- {x} with curly braces -->
  <path d="M238 309 Q222 309 222 329 Q222 349 210 349 Q222 349 222 369 Q222 389 238 389" stroke="white" stroke-width="14" stroke-linecap="round" fill="none"/>
  <path d="M266 317L322 373M322 317L266 373" stroke="white" stroke-width="20" stroke-linecap="round"/>
  <path d="M350 309 Q366 309 366 329 Q366 349 378 349 Q366 349 366 369 Q366 389 350 389" stroke="white" stroke-width="14" stroke-linecap="round" fill="none"/>
</svg>
`;

// Maskable icon needs safe-area padding (icon occupies ~80% of canvas)
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#07070a"/>
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <rect width="512" height="512" rx="96" fill="#07070a"/>
    <!-- Large P -->
    <path d="M112 80H272C327.228 80 372 124.772 372 180C372 235.228 327.228 280 272 280H192V400H112V80Z" fill="white"/>
    <path d="M192 140H260C282.091 140 300 157.909 300 180C300 202.091 282.091 220 260 220H192V140Z" fill="#07070a"/>
    <!-- {x} with curly braces -->
    <path d="M238 309 Q222 309 222 329 Q222 349 210 349 Q222 349 222 369 Q222 389 238 389" stroke="white" stroke-width="14" stroke-linecap="round" fill="none"/>
    <path d="M266 317L322 373M322 317L266 373" stroke="white" stroke-width="20" stroke-linecap="round"/>
    <path d="M350 309 Q366 309 366 329 Q366 349 378 349 Q366 349 366 369 Q366 389 350 389" stroke="white" stroke-width="14" stroke-linecap="round" fill="none"/>
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

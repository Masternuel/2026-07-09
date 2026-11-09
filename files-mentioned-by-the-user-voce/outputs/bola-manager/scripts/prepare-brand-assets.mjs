import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const directory = fileURLToPath(new URL('../public/assets/brand/', import.meta.url));
export const brandRenditions = [
  { file: 'bola-manager-logo-512.png', size: 512 },
  { file: 'bola-manager-icon.png', size: 256 },
  { file: 'bola-manager-favicon.png', size: 64 },
];

export async function prepareBrandAssets() {
  await Promise.all(brandRenditions.map(({ file, size }) => sharp(join(directory, 'bola-manager-logo.png'))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(join(directory, file))));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareBrandAssets();
  console.log('Brand assets: 3 transparent renditions prepared; original unchanged.');
}

import sharp from 'sharp';

for (const size of [16, 32, 48, 96, 128]) {
  await sharp('assets/noble-gas.png').resize(size, size).png().toFile(`public/icon/${size}.png`);
}

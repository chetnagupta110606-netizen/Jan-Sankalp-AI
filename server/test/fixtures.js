const Jimp = require('jimp');
const piexif = require('piexifjs');

function toDms(value) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 10000);
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 10000],
  ];
}

async function scenePhoto({ seed = 1, noise = 0 } = {}) {
  const size = 256;
  const image = new Jimp(size, size, 0xffffffff);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const base = ((x * seed) % 64) + ((y * 3) % 128);
      const jitter = noise ? ((x * 7 + y * 13) % 255) * noise : 0;
      const value = Math.max(0, Math.min(255, Math.round(base + jitter)));
      image.setPixelColor(Jimp.rgbaToInt(value, value, value, 255), x, y);
    }
  }

  return image.getBufferAsync(Jimp.MIME_JPEG);
}

async function geotaggedPhoto({ latitude, longitude, seed, noise } = {}) {
  const buffer = await scenePhoto({ seed, noise });

  if (latitude === undefined || longitude === undefined) {
    return buffer;
  }

  const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  const exif = {
    '0th': {},
    Exif: {},
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: latitude >= 0 ? 'N' : 'S',
      [piexif.GPSIFD.GPSLatitude]: toDms(latitude),
      [piexif.GPSIFD.GPSLongitudeRef]: longitude >= 0 ? 'E' : 'W',
      [piexif.GPSIFD.GPSLongitude]: toDms(longitude),
    },
  };

  const withExif = piexif.insert(piexif.dump(exif), dataUrl);
  return Buffer.from(withExif.split(',')[1], 'base64');
}

module.exports = { scenePhoto, geotaggedPhoto };

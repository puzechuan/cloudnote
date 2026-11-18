import { hashPassword } from './crypto.js';

/**
 * 5x7 点阵字体：只包含不含歧义的字母与数字。
 * 验证码用矩形路径绘制，SVG 中不出现任何 <text>，无法直接读字符串。
 */
export const CAPTCHA_FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LETTERS + DIGITS;

function randomInt(max) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
}

function pick(source) {
  return source[randomInt(source.length)];
}

/** 生成 6 位字母 + 数字混合验证码（至少各含一个）。 */
export function generateCaptchaCode(length = 6) {
  const chars = [pick(LETTERS), pick(DIGITS)];
  while (chars.length < length) {
    chars.push(pick(ALL));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
}

/** 生成 SVG 验证码图片（纯矩形与噪点，不含文本节点）。 */
export function renderCaptchaSvg(code) {
  const width = 168;
  const height = 58;
  const cell = 4;
  const glyphWidth = 5 * cell;
  const glyphHeight = 7 * cell;
  const gap = 6;
  const total = code.length * glyphWidth + (code.length - 1) * gap;
  let x = (width - total) / 2;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="验证码">`,
    `<rect width="${width}" height="${height}" fill="#f6f6f6"/>`
  ];

  for (let i = 0; i < 4; i += 1) {
    const x1 = randomInt(width);
    const y1 = randomInt(height);
    const x2 = randomInt(width);
    const y2 = randomInt(height);
    const cx = randomInt(width);
    const cy = randomInt(height);
    parts.push(
      `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#111" stroke-opacity="0.16" stroke-width="1.2"/>`
    );
  }

  for (const ch of code) {
    const glyph = CAPTCHA_FONT[ch] || CAPTCHA_FONT.A;
    const angle = randomInt(17) - 8;
    const dy = randomInt(7) - 3;

    parts.push(
      `<g transform="translate(${x} ${12 + dy}) rotate(${angle} ${glyphWidth / 2} ${glyphHeight / 2})">`
    );
    glyph.forEach((row, ry) => {
      for (let rx = 0; rx < 5; rx += 1) {
        if (row[rx] === '1') {
          parts.push(
            `<rect x="${rx * cell}" y="${ry * cell}" width="${cell}" height="${cell}" fill="#0f0f0f"/>`
          );
        }
      }
    });
    parts.push('</g>');

    x += glyphWidth + gap;
  }

  for (let i = 0; i < 26; i += 1) {
    parts.push(
      `<circle cx="${randomInt(width)}" cy="${randomInt(height)}" r="${(1 + randomInt(15) / 10).toFixed(1)}" fill="#0f0f0f" fill-opacity="0.16"/>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

/** 验证码哈希（大小写不敏感）。 */
export async function hashCaptchaCode(code) {
  return hashPassword(String(code || '').trim().toUpperCase());
}

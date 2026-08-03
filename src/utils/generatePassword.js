const crypto = require('crypto');

// يولّد كلمة مرور عشوائية قوية مقروءة (بلا أحرف ملتبسة مثل O/0 و l/1).
// تضمن وجود حرف كبير وصغير ورقم ورمز.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#%&*!?';

const pick = (chars) => chars[crypto.randomInt(0, chars.length)];

const generateStrongPassword = (length = 10) => {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = [];
  for (let i = required.length; i < length; i += 1) rest.push(pick(all));
  const chars = [...required, ...rest];
  // خلط Fisher–Yates باستخدام مصدر عشوائي آمن.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

module.exports = { generateStrongPassword };

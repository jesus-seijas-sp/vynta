const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  inverse: [7, 27],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
  bgRed: [41, 49],
  bgGreen: [42, 49],
  bgYellow: [43, 49],
};

function detectColors({ env } = process) {
  if ('NO_COLOR' in env || env.FORCE_COLOR === '0') {
    return false;
  }
  if (env.FORCE_COLOR) {
    return true;
  }
  return Boolean(process.stdout?.isTTY) && env.TERM !== 'dumb';
}

const colors = {};

function setColors(enabled) {
  colors.enabled = enabled;
  Object.entries(CODES).forEach(([name, [open, close]]) => {
    colors[name] = enabled ? (str) => `\u001b[${open}m${str}\u001b[${close}m` : (str) => String(str);
  });
}

setColors(detectColors());

module.exports = { colors, setColors, detectColors };

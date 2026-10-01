// Glob patterns to regular expressions: **, *, ?, {a,b}, [abc] and the extglobs ?(), *(), +(), @(), !().

const ESCAPE = new Set(['.', '+', '^', '$', '(', ')', '|', '\\', '/']);

// inGroup: inside an extglob, where "|" separates alternatives.
function convert(glob, inGroup = false) {
  let result = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    const next = glob[i + 1];
    if ('?*+@!'.includes(ch) && next === '(') {
      const close = glob.indexOf(')', i);
      const inner = convert(glob.slice(i + 2, close), true);
      const suffix = { '?': '?', '*': '*', '+': '+', '@': '' }[ch];
      result += ch === '!' ? `(?!(?:${inner}))[^/]*` : `(?:${inner})${suffix}`;
      i = close;
    } else if (ch === '*' && next === '*') {
      // "**/" matches any number of directories, including none.
      if (glob[i + 2] === '/') {
        result += '(?:.*/)?';
        i += 2;
      } else {
        result += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      result += '[^/]*';
    } else if (ch === '?') {
      result += '[^/]';
    } else if (ch === '{') {
      braces += 1;
      result += '(?:';
    } else if (ch === '}' && braces > 0) {
      braces -= 1;
      result += ')';
    } else if ((ch === ',' && braces > 0) || (ch === '|' && inGroup)) {
      result += '|';
    } else if (ch === '[') {
      const close = glob.indexOf(']', i);
      result += glob.slice(i, close + 1).replace('[!', '[^');
      i = close;
    } else {
      result += ESCAPE.has(ch) ? `\\${ch}` : ch;
    }
  }
  return result;
}

const globToRegExp = (glob) => new RegExp(`^${convert(glob)}$`);

module.exports = { globToRegExp };

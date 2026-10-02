const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { threadId } = require('node:worker_threads');
const { applyPlugins, pluginNames } = require('./plugins');
const Module = require('node:module');
const { expand: expandGlobImports } = require('./glob-imports');
const { scan, CODE } = require('./modules/scanner');
const { compileOptions } = require('./tsconfig');
const { markTypeImports } = require('./type-imports');

// Node strips TypeScript types but does not understand JSX, so a project that uses it needs a
// transform. vyntra brings none: it loads the one the project already has (esbuild, sucrase or
// typescript), the first time a file needs it, and only for the files that do. A project without
// JSX never loads a transformer and pays nothing, which is what keeps the common case fast.

const TRANSFORMERS = ['esbuild', 'sucrase', 'typescript'];
const ALWAYS = new Set(['.tsx', '.jsx']);
const MAYBE = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const TS = new Set(['.ts', '.mts', '.cts']);

// A tag opening after something that cannot end an expression: "return <a", "=> <a", "(<a", "<Foo".
// Deliberately generous — a false positive costs one transform, a false negative costs a crash.
const LOOKS_LIKE_JSX = /(^|[=(,:[;{}\s>?])<[A-Za-z][\w.:-]*[\s/>]|<\/[A-Za-z]|<>/;

// The source with strings, templates, comments and regular expressions blanked out (line breaks kept).
function codeOnly(source) {
  const { kind } = scan(source);
  const chars = new Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    chars[i] = kind[i] === CODE || source[i] === '\n' ? source[i] : ' ';
  }
  return chars.join('');
}

// A tag in the code, not in a string: HTML in the strings of a CommonJS test ('<script>' in an XSS
// test) is not JSX, and transforming the file would turn it into an ES module without require().
// The scan only runs when the quick check finds something that looks like a tag.
const looksLikeJsx = (source) => LOOKS_LIKE_JSX.test(source) && LOOKS_LIKE_JSX.test(codeOnly(source));

// A bundler turns these into something a module can import: a stylesheet into its class names, an
// image into its URL. Node has no loader for them and refuses the file, which fails a component
// test for a stylesheet it never reads. They become a stub with the shape the code expects.
const STYLE = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.pcss', '.postcss']);
const ASSET = new Set([
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.wav',
  '.pdf',
  '.txt',
  '.md',
]);

let loader = null;
let rootDir = process.cwd();
let enabled = true;
const cache = new Map();

function assetExtensions() {
  return [...STYLE, ...ASSET];
}

// The value require() should hand back for a stylesheet or an asset.
function assetExports(file) {
  if (STYLE.has(path.extname(file).toLowerCase())) {
    return new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) });
  }
  return file;
}

function isAsset(file) {
  const ext = path.extname(file).toLowerCase();
  return STYLE.has(ext) || ASSET.has(ext);
}

// A stylesheet answers to any class name it is asked for, as a CSS module would; everything else is
// its own URL, which is what a bundler gives an image or a font.
function assetSource(file) {
  if (STYLE.has(path.extname(file).toLowerCase())) {
    return 'const styles = new Proxy({}, { get: (_, key) => (typeof key === "string" ? key : undefined) });\nexport default styles;\n';
  }
  return `export default ${JSON.stringify(file)};\n`;
}

// A bundler lets a module import JSON with no ceremony; Node wants an import attribute the source
// does not carry. Handing back the data as a module keeps both happy.
function isJson(file) {
  return path.extname(file).toLowerCase() === '.json' && !file.includes(`${path.sep}node_modules${path.sep}`);
}

function jsonSource(file) {
  return `export default ${fs.readFileSync(file, 'utf8')};\n`;
}

let compiledDir = null;
let compilerOverrides = {};

function configure(config = {}) {
  rootDir = config.rootDir ?? process.cwd();
  enabled = config.transform !== false;
  compiledDir = config.transformCacheDir ?? null;
  compilerOverrides = config.compilerOptions ?? {};
  cache.clear();
}

// The project's tsconfig.json, under what the config sets (a vitest config's Oxc or esbuild options).
const typescriptOptions = () => ({ ...compileOptions(rootDir), ...compilerOverrides });

// The project's transformer, looked up from the project rather than depended on.
function findTransformer() {
  if (loader !== null) {
    return loader;
  }
  const require = Module.createRequire(path.join(rootDir, 'package.json'));
  const load = (name) => {
    try {
      return { name, module: require(name) };
    } catch {
      return null;
    }
  };
  // Only TypeScript emits the decorator metadata dependency injection reads (Nest, Angular, TypeORM).
  const order = typescriptOptions().emitDecoratorMetadata ? ['typescript', ...TRANSFORMERS] : TRANSFORMERS;
  loader = order.reduce((found, name) => found ?? load(name), null) ?? { name: null, module: null };
  return loader;
}

function needsTransform(file) {
  if (!enabled || file.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }
  const ext = path.extname(file);
  if (ALWAYS.has(ext)) {
    return true;
  }
  if (!MAYBE.has(ext)) {
    return false;
  }
  // Node strips types without understanding them: it leaves `import { Size }` standing when Size is
  // a type the sibling only exported as one, and refuses a constructor's parameter properties. A
  // real transformer knows which names are types, so TypeScript goes through it when there is one.
  if (TS.has(ext) && findTransformer().name) {
    return true;
  }
  if (!cache.has(`glob:${file}`)) {
    let glob = false;
    try {
      glob = fs.readFileSync(file, 'utf8').includes('import.meta.glob');
    } catch {
      glob = false;
    }
    cache.set(`glob:${file}`, glob);
  }
  if (cache.get(`glob:${file}`)) {
    return true;
  }
  if (!cache.has(file)) {
    let jsx = false;
    try {
      jsx = looksLikeJsx(fs.readFileSync(file, 'utf8'));
    } catch {
      jsx = false;
    }
    cache.set(file, jsx);
  }
  return cache.get(file);
}

// A .ts file is TypeScript, not TSX: parsed as TSX its generics and assertions stop meaning what
// they say. Plain JavaScript is read as JSX, which is what lets a .js file hold a component.
const LOADERS = { ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', jsx: 'jsx', js: 'jsx', mjs: 'jsx', cjs: 'jsx' };

function esbuildOptions(file) {
  const ext = path.extname(file).replace('.', '');
  const { experimentalDecorators, useDefineForClassFields } = typescriptOptions();
  return {
    loader: LOADERS[ext] ?? 'js',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    sourcefile: file,
    sourcemap: 'inline',
    tsconfigRaw: { compilerOptions: { experimentalDecorators, useDefineForClassFields } },
  };
}

const USES_PATHS = /\b__(?:dirname|filename)\b/;
const DECLARES_PATHS = /\b(?:const|let|var|function)\s+__(?:dirname|filename)\b/;
const USES_REQUIRE = /(?<![.$\w])require\s*(?:\(|\.)/;
const DECLARES_REQUIRE = /\b(?:const|let|var|function|import)\s+(?:\{[^}]*\b)?require\b/;

// Vitest gives a test file the CommonJS __dirname, __filename and require(), which an ES module lacks. Prepended
// on the first line, so the source map's lines still match.
function withPaths(code) {
  if (code === null) {
    return code;
  }
  const paths = USES_PATHS.test(code) && !DECLARES_PATHS.test(code);
  const require = USES_REQUIRE.test(code) && !DECLARES_REQUIRE.test(code);
  const prelude = [
    paths ? 'const __dirname = import.meta.dirname, __filename = import.meta.filename;' : '',
    require
      ? 'import { createRequire as __vyntraCreateRequire } from "node:module"; const require = __vyntraCreateRequire(import.meta.url);'
      : '',
  ].join('');
  return `${prelude}${code}`;
}

// The source with JSX (and any types) compiled away, or null when the project has no transformer.
function compile(rawSource, file) {
  const source = expandGlobImports(applyPlugins(rawSource, file), file);
  const { name, module: transformer } = findTransformer();
  if (!name) {
    return null;
  }
  if (name === 'esbuild') {
    return transformer.transformSync(source, esbuildOptions(file)).code;
  }
  if (name === 'sucrase') {
    const ts = /\.[cm]?tsx?$/.test(file);
    return transformer.transform(source, {
      transforms: ['jsx', ...(ts ? ['typescript'] : [])],
      jsxRuntime: 'automatic',
      filePath: file,
    }).code;
  }
  return transformer.transpileModule(source, {
    compilerOptions: {
      ...typescriptOptions(),
      jsx: transformer.JsxEmit.ReactJSX,
      target: 'ESNext',
      module: 'ESNext',
      inlineSourceMap: true,
      inlineSources: true,
    },
    fileName: file,
  }).outputText;
}

// Each test file imports its own copy of the project's modules, so the same file is compiled again for
// every test file that reaches it. The output is kept: in memory for the thread, and on disk between runs,
// keyed by the source and what compiles it. A file with import.meta.glob depends on which files exist too,
// so it is only kept in memory.
const compiled = new Map();
// Changes when what vyntra adds to the compiled code (withPaths) does, so older entries are not reused.
const OUTPUT_VERSION = 2;

function compiledKey(source, file) {
  const { name, module: transformer } = findTransformer();
  const plugins = pluginNames().join(',');
  const options = JSON.stringify(typescriptOptions());
  return crypto
    .createHash('sha1')
    .update(`${OUTPUT_VERSION}\0${file}\0${name}@${transformer?.version ?? ''}\0${plugins}\0${options}\0${source}`)
    .digest('hex');
}

function readCompiled(key) {
  if (!compiledDir) {
    return null;
  }
  try {
    return fs.readFileSync(path.join(compiledDir, `${key}.js`), 'utf8');
  } catch {
    return null;
  }
}

// Written aside and renamed into place: with an empty cache every worker compiles the same modules at once, and one
// reading a file another is still writing would run half of it ("Unexpected end of input").
function writeCompiled(key, code) {
  if (!compiledDir) {
    return;
  }
  const file = path.join(compiledDir, `${key}.js`);
  const partial = `${file}.${process.pid}-${threadId}.tmp`;
  try {
    fs.mkdirSync(compiledDir, { recursive: true });
    fs.writeFileSync(partial, code);
    fs.renameSync(partial, file);
  } catch {
    // Another worker put it there first (Windows will not replace a file being read), or the cache can not be
    // written: either way this compile is not lost, only not kept.
    try {
      fs.rmSync(partial, { force: true });
    } catch {
      // Left for the next run to overwrite.
    }
  }
}

function transform(rawSource, file) {
  const kept = compiled.get(file);
  if (kept?.source === rawSource) {
    return kept.code;
  }
  // Which imported names are types depends on other files: the compiled code is kept for the source with them marked.
  const source = TS.has(path.extname(file)) ? markTypeImports(rawSource, file) : rawSource;
  const onDisk = compiledDir && !source.includes('import.meta.glob');
  const key = onDisk ? compiledKey(source, file) : null;
  let code = key ? readCompiled(key) : null;
  if (code === null) {
    code = withPaths(compile(source, file));
    if (key && code !== null) {
      writeCompiled(key, code);
    }
  }
  compiled.set(file, { source: rawSource, code });
  return code;
}

function transformerName() {
  return findTransformer().name;
}

module.exports = {
  readCompiled,
  writeCompiled,
  looksLikeJsx,
  configure,
  needsTransform,
  transform,
  transformerName,
  isAsset,
  assetSource,
  isJson,
  jsonSource,
  assetExtensions,
  assetExports,
};

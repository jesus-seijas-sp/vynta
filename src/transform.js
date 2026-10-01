const fs = require('node:fs');
const path = require('node:path');
const { applyPlugins } = require('./plugins');
const Module = require('node:module');
const { expand: expandGlobImports } = require('./glob-imports');

// Node strips TypeScript types but does not understand JSX, so a project that uses it needs a
// transform. vynta brings none: it loads the one the project already has (esbuild, sucrase or
// typescript), the first time a file needs it, and only for the files that do. A project without
// JSX never loads a transformer and pays nothing, which is what keeps the common case fast.

const TRANSFORMERS = ['esbuild', 'sucrase', 'typescript'];
const ALWAYS = new Set(['.tsx', '.jsx']);
const MAYBE = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const TS = new Set(['.ts', '.mts', '.cts']);

// A tag opening after something that cannot end an expression: "return <a", "=> <a", "(<a", "<Foo".
// Deliberately generous — a false positive costs one transform, a false negative costs a crash.
const LOOKS_LIKE_JSX = /(^|[=(,:[;{}\s>?])<[A-Za-z][\w.:-]*[\s/>]|<\/[A-Za-z]|<>/;

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

function configure(config = {}) {
  rootDir = config.rootDir ?? process.cwd();
  enabled = config.transform !== false;
  cache.clear();
}

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
  loader = TRANSFORMERS.reduce((found, name) => found ?? load(name), null) ?? { name: null, module: null };
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
      jsx = LOOKS_LIKE_JSX.test(fs.readFileSync(file, 'utf8'));
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
  return {
    loader: LOADERS[ext] ?? 'js',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    sourcefile: file,
    sourcemap: 'inline',
  };
}

const USES_PATHS = /\b__(?:dirname|filename)\b/;
const DECLARES_PATHS = /\b(?:const|let|var|function)\s+__(?:dirname|filename)\b/;

// Vite gives a test file the CommonJS __dirname and __filename, which an ES module lacks. Prepended
// on the first line, so the source map's lines still match.
function withPaths(code) {
  if (code === null || !USES_PATHS.test(code) || DECLARES_PATHS.test(code)) {
    return code;
  }
  return `const __dirname = import.meta.dirname, __filename = import.meta.filename;${code}`;
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
    compilerOptions: { jsx: transformer.JsxEmit.ReactJSX, target: 'ESNext', module: 'ESNext' },
    fileName: file,
  }).outputText;
}

function transform(rawSource, file) {
  return withPaths(compile(rawSource, file));
}

function transformerName() {
  return findTransformer().name;
}

module.exports = {
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

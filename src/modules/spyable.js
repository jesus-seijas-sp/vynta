// vi.spyOn(namespace, 'name') on `import * as namespace from './module'`. An ES module's namespace is
// read-only and its importers are bound to its exports, so a spy can only take effect from inside
// the module. The modules a test spies on this way are compiled so their exports can be reassigned,
// and each registers a setter per export under its own namespace: the spy goes in through it, and
// every importer sees it, as under vitest. Only the modules a test file names are touched.

const SETTERS = Symbol.for('vyntra.exportSetters');
globalThis[SETTERS] ??= new WeakMap();

const NAMESPACE_IMPORT = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"\n]+)['"]/g;
const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const DECLARED = new RegExp(`^export\\s+(?:let|var|const)\\s+(${IDENTIFIER})`, 'gm');
const FUNCTION = new RegExp(`^export\\s+(?:async\\s+)?function\\*?\\s+(${IDENTIFIER})`, 'gm');
const CLASS = new RegExp(`^export\\s+class\\s+(${IDENTIFIER})`, 'gm');
const DEFAULT_NAMED = new RegExp(`^export\\s+default\\s+(?:async\\s+)?(?:function\\*?|class)\\s+(${IDENTIFIER})`, 'm');
const DEFAULT_ANONYMOUS = /^export\s+default\s+/m;
const LIST = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
const ANONYMOUS_DEFAULT = '__vyntra_default__';

const spyable = new Set();

// Marks the modules a test file imports as a namespace and spies on.
function markSpyable(testFile, source, resolve) {
  [...source.matchAll(NAMESPACE_IMPORT)].forEach(([, name, specifier]) => {
    if (new RegExp(`\\b(?:vi|jest)\\.spyOn\\(\\s*${name.replace(/\$/g, '\\$')}\\b`).test(source)) {
      spyable.add(resolve(specifier, testFile));
    }
  });
}

const isSpyable = (file) => spyable.has(file);

// export name -> the local binding a setter assigns.
function exportBindings(source) {
  const bindings = new Map();
  [DECLARED, FUNCTION, CLASS].forEach((pattern) => {
    [...source.matchAll(pattern)].forEach(([, name]) => bindings.set(name, name));
  });
  [...source.matchAll(LIST)].forEach(([, list]) => {
    list
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item && !item.startsWith('type '))
      .forEach((item) => {
        const [local, exported = local] = item.split(/\s+as\s+/).map((part) => part.trim());
        bindings.set(exported, local);
      });
  });
  return bindings;
}

// The module, with exports that can be reassigned and a setter for each registered under its namespace.
function makeSpyable(source, url) {
  let code = source.replace(/^export\s+const\s+/gm, 'export let ');
  const bindings = exportBindings(code);
  const named = DEFAULT_NAMED.exec(code);
  if (named) {
    bindings.set('default', named[1]);
  } else if (DEFAULT_ANONYMOUS.test(code)) {
    code = `${code.replace(DEFAULT_ANONYMOUS, `let ${ANONYMOUS_DEFAULT} = `)}\nexport { ${ANONYMOUS_DEFAULT} as default };`;
    bindings.set('default', ANONYMOUS_DEFAULT);
  }
  const setters = [...bindings].map(
    ([exported, local]) => `${JSON.stringify(exported)}: (value) => { ${local} = value; }`
  );
  return [
    code,
    `import * as __vyntra_self__ from ${JSON.stringify(url)};`,
    `globalThis[Symbol.for('vyntra.exportSetters')].set(__vyntra_self__, { ${setters.join(', ')} });`,
  ].join('\n');
}

// The setter of a namespace's export, when the module was made spyable.
const exportSetter = (namespace, key) => globalThis[SETTERS].get(namespace)?.[key];

module.exports = { markSpyable, isSpyable, makeSpyable, exportSetter };

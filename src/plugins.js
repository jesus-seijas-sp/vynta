// The transform hooks of Vite plugins in the config, run on every file vyntra compiles, so a rewrite a
// project relies on under vitest (an import split into deep paths, a barrel flattened) happens here
// too. vyntra's module hooks are synchronous, so only synchronous transforms can run. Plugins are
// functions, which do not cross to a worker: each thread loads them from the config file itself.

const ORDER = { pre: 0, undefined: 1, post: 2 };

let plugins = [];

const context = {
  warn: (message) => process.emitWarning(String(message?.message ?? message)),
  error: (message) => {
    throw message instanceof Error ? message : new Error(String(message));
  },
};

async function loadPlugins(config) {
  let list = config.plugins;
  const missing = !list?.some?.((plugin) => typeof plugin?.transform === 'function');
  if (missing && config.configFile && config.transformPlugins !== false) {
    // eslint-disable-next-line global-require -- the config is only reloaded where it lost its functions
    const { importConfig } = require('./cli/config');
    list = (await importConfig(config.configFile))?.plugins;
  }
  plugins = [list ?? []]
    .flat(Infinity)
    .filter((plugin) => typeof plugin?.transform === 'function')
    .sort((a, b) => ORDER[a.enforce] - ORDER[b.enforce]);
  const resolved = { root: config.rootDir, command: 'serve', mode: 'test', isProduction: false, plugins };
  await Promise.all(plugins.map((plugin) => plugin.configResolved?.(resolved)));
  // Vite starts a build before it transforms anything: a plugin may set up what its transform reads.
  await Promise.all(plugins.map((plugin) => plugin.buildStart?.call(context, {})));
}

function applyPlugins(code, file) {
  return plugins.reduce((source, plugin) => {
    const result = plugin.transform.call(context, source, file);
    if (typeof result?.then === 'function') {
      throw new Error(`The transform hook of the "${plugin.name}" plugin is async: vyntra runs synchronous ones only`);
    }
    if (result == null) {
      return source;
    }
    return typeof result === 'string' ? result : (result.code ?? source);
  }, code);
}

const pluginNames = () => plugins.map((plugin) => plugin.name ?? '?');

module.exports = { loadPlugins, applyPlugins, pluginNames };

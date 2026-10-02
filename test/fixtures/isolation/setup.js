// As Strapi's setup file: a global defined without configurable, by every file's setup.
Object.defineProperty(globalThis, 'definedOnce', { get: () => 'value' });

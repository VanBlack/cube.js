const exports = require('./dist/src/index');
const { CubejsServerCore } = require('./dist/src/core/server');

/**
 * After 5 years working with TypeScript, now I know
 * that commonjs and nodejs require is not compatibility with using export default
 */
module.exports = CubejsServerCore;

// eslint-disable-next-line no-restricted-syntax
for (const [key, module] of Object.entries(exports)) {
  module.exports[key] = module;
}

const { ContentTree, ContentPlugin } = require('./core/content');
const { Environment } = require('./core/environment');
const { TemplatePlugin } = require('./core/templates');

function createEnvironment(...args) {
  return Environment.create(...args);
}

module.exports = createEnvironment;
module.exports.Environment = Environment;
module.exports.ContentPlugin = ContentPlugin;
module.exports.ContentTree = ContentTree;
module.exports.TemplatePlugin = TemplatePlugin;

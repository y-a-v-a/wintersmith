const path = require('path');
const minimatch = require('minimatch');

const { readdirRecursive } = require('./utils');

class TemplatePlugin {
  /* A template plugin subclass have to implement a `render` instance method and a `fromFile` class method. */
  render(_locals, _callback) {
    /* Render template using *locals* and *callback* with a ReadStream or Buffer containing the result. */
    throw new Error('Not implemented.');
  }

  static fromFile(_filepath, _callback) {
    /* *callback* with a instance of <TemplatePlugin> created from *filepath*. Where *filepath* is
       an object containing the full and relative (to templates directory) path to the file. */
    throw new Error('Not implemented.');
  }
}

function readdirRecursiveAsync(directory) {
  return new Promise((resolve, reject) => {
    readdirRecursive(directory, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

function fromFileAsync(pluginClass, filepath) {
  return new Promise((resolve, reject) => {
    pluginClass.fromFile(filepath, (error, template) => (error ? reject(error) : resolve(template)));
  });
}

async function loadTemplatesAsync(env) {
  /* Load and any templates associated with the environment *env*. Calls with
     a map of templates as {<filename>: <TemplatePlugin instance>} */
  const templates = {};
  const filenames = await readdirRecursiveAsync(env.templatesPath);

  for (const filename of filenames) {
    const filepath = {
      full: path.join(env.templatesPath, filename),
      relative: filename
    };

    let plugin = null;
    for (let i = env.templatePlugins.length - 1; i >= 0; i -= 1) {
      if (minimatch(filepath.relative, env.templatePlugins[i].pattern)) {
        plugin = env.templatePlugins[i];
        break;
      }
    }

    if (plugin != null) {
      try {
        const template = await fromFileAsync(plugin.class, filepath);
        templates[filepath.relative] = template;
      } catch (error) {
        error.message = `template ${filepath.relative}: ${error.message}`;
        throw error;
      }
    }
  }

  return templates;
}

function loadTemplates(env, callback) {
  loadTemplatesAsync(env)
    .then((templates) => callback(null, templates))
    .catch((error) => callback(error));
}

module.exports = { TemplatePlugin, loadTemplates };

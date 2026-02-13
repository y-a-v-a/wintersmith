const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const utils = require('./utils');
const { Config } = require('./config');
const { ContentPlugin, ContentTree, StaticFile } = require('./content');
const { TemplatePlugin, loadTemplates } = require('./templates');
const { logger } = require('./logger');
const { render } = require('./renderer');
const { runGenerator } = require('./generator');

const { readJSONSync } = utils;

class Environment extends EventEmitter {
  /* The Wintersmith environment. */

  constructor(config, workDir, log) {
    super();
    /* Create a new Environment, *config* is a Config instance, *workDir* is the
       working directory and *logger* is a log instance implementing methods for
       error, warn, verbose and silly loglevels. */
    this.workDir = path.resolve(workDir);
    this.logger = log;
    this.utils = utils;
    this.ContentTree = ContentTree;
    this.ContentPlugin = ContentPlugin;
    this.TemplatePlugin = TemplatePlugin;
    this.loadedModules = [];
    this.setConfig(config);
    this.reset();
  }

  reset() {
    /* Reset environment and clear any loaded modules from require.cache */
    this.views = {
      none: (...args) => {
        const callback = args[args.length - 1];
        return callback();
      }
    };
    this.generators = [];
    this.plugins = { StaticFile };
    this.templatePlugins = [];
    this.contentPlugins = [];
    this.helpers = {};
    let id;
    while ((id = this.loadedModules.pop())) {
      this.logger.verbose(`unloading: ${id}`);
      delete require.cache[id];
    }
    this.setupLocals();
  }

  setConfig(config) {
    this.config = config;
    this.contentsPath = this.resolvePath(this.config.contents);
    this.templatesPath = this.resolvePath(this.config.templates);
  }

  setupLocals() {
    /* Resolve locals and loads any required modules. */
    this.locals = {};
    if (typeof this.config.locals === 'string') {
      const filename = this.resolvePath(this.config.locals);
      this.logger.verbose(`loading locals from: ${filename}`);
      this.locals = readJSONSync(filename);
    } else {
      this.locals = this.config.locals;
    }

    const requires = this.config.require;
    for (const alias in requires) {
      const id = requires[alias];
      logger.verbose(`loading module '${id}' available in locals as '${alias}'`);
      if (this.locals[alias] != null) {
        logger.warn(`module '${id}' overwrites previous local with the same key ('${alias}')`);
      }
      try {
        this.locals[alias] = this.loadModule(id);
      } catch (error) {
        logger.warn(`unable to load '${id}': ${error.message}`);
      }
    }
  }

  resolvePath(pathname) {
    /* Resolve *pathname* in working directory, returns an absolute path. */
    return path.resolve(this.workDir, pathname || '');
  }

  resolveContentsPath(pathname) {
    /* Resolve *pathname* in contents directory, returns an absolute path. */
    return path.resolve(this.contentsPath, pathname || '');
  }

  resolveModule(moduleId) {
    /* Resolve *module* to an absolute path, mimicking the node.js module loading system. */
    switch (moduleId[0]) {
      case '.':
        return require.resolve(this.resolvePath(moduleId));
      case '/':
        return require.resolve(moduleId);
      default: {
        const nodeDir = this.resolvePath('node_modules');
        try {
          return require.resolve(path.join(nodeDir, moduleId));
        } catch (error) {
          return require.resolve(moduleId);
        }
      }
    }
  }

  relativePath(pathname) {
    /* Resolve path relative to working directory. */
    return path.relative(this.workDir, pathname);
  }

  relativeContentsPath(pathname) {
    /* Resolve path relative to contents directory. */
    return path.relative(this.contentsPath, pathname);
  }

  registerContentPlugin(group, pattern, plugin) {
    /* Add a content *plugin* to the environment. Files in the contents directory
       matching the glob *pattern* will be instantiated using the plugin's `fromFile`
       factory method. The *group* argument is used to group the loaded instances under
       each directory. I.e. plugin instances with the group 'textFiles' can be found
       in `contents.somedir._.textFiles`. */
    this.logger.verbose(`registering content plugin ${plugin.name} that handles: ${pattern}`);
    this.plugins[plugin.name] = plugin;
    this.contentPlugins.push({
      group,
      pattern,
      class: plugin
    });
  }

  registerTemplatePlugin(pattern, plugin) {
    /* Add a template *plugin* to the environment. All files in the template directory
       matching the glob *pattern* will be passed to the plugin's `fromFile` classmethod. */
    this.logger.verbose(`registering template plugin ${plugin.name} that handles: ${pattern}`);
    this.plugins[plugin.name] = plugin;
    this.templatePlugins.push({
      pattern,
      class: plugin
    });
  }

  registerGenerator(group, generator) {
    /* Add a generator to the environment. The generator function is called with the env and the
       current content tree. It should return a object with nested ContentPlugin instances.
       These will be merged into the final content tree. */
    this.generators.push({
      group,
      fn: generator
    });
  }

  registerView(name, view) {
    /* Add a view to the environment. */
    this.views[name] = view;
  }

  getContentGroups() {
    /* Return an array of all registered content groups */
    const groups = [];
    for (const plugin of this.contentPlugins) {
      if (!groups.includes(plugin.group)) {
        groups.push(plugin.group);
      }
    }
    for (const generator of this.generators) {
      if (!groups.includes(generator.group)) {
        groups.push(generator.group);
      }
    }
    return groups;
  }

  loadModule(moduleId, unloadOnReset = false) {
    /* Requires and returns *module*, resolved from the current working directory. */
    this.logger.silly(`loading module: ${moduleId}`);
    const id = this.resolveModule(moduleId);
    this.logger.silly(`resolved: ${id}`);
    const rv = require(id);
    if (unloadOnReset) {
      this.loadedModules.push(id);
    }
    return rv;
  }

  loadPluginModule(moduleOrId, callback) {
    /* Load a plugin *module*. Calls *callback* when plugin is done loading, or an error occurred. */
    let id = 'unknown';
    const done = (error) => {
      if (error != null) {
        error.message = `Error loading plugin '${id}': ${error.message}`;
      }
      return callback(error);
    };

    if (typeof moduleOrId === 'string') {
      id = moduleOrId;
      try {
        moduleOrId = this.loadModule(moduleOrId);
      } catch (error) {
        done(error);
        return;
      }
    }

    try {
      return moduleOrId.call(null, this, done);
    } catch (error) {
      return done(error);
    }
  }

  loadViewModule(id, callback) {
    /* Load a view *module* and add it to the environment. */
    this.logger.verbose(`loading view: ${id}`);
    let module;
    try {
      module = this.loadModule(id, true);
    } catch (error) {
      error.message = `Error loading view '${id}': ${error.message}`;
      callback(error);
      return;
    }
    this.registerView(path.basename(id), module);
    return callback();
  }

  loadPlugins(callback) {
    this.loadPluginsAsync()
      .then(() => callback())
      .catch((error) => callback(error));
  }

  async loadPluginsAsync() {
    /* Loads any plugin found in *@config.plugins*. */
    for (const plugin of this.constructor.defaultPlugins) {
      this.logger.verbose(`loading default plugin: ${plugin}`);
      const id = require.resolve(`./../plugins/${plugin}`);
      const module = require(id);
      this.loadedModules.push(id);
      await new Promise((resolve, reject) => {
        this.loadPluginModule(module, (error) => (error ? reject(error) : resolve()));
      });
    }

    for (const plugin of this.config.plugins) {
      this.logger.verbose(`loading plugin: ${plugin}`);
      await new Promise((resolve, reject) => {
        this.loadPluginModule(plugin, (error) => (error ? reject(error) : resolve()));
      });
    }
  }

  loadViews(callback) {
    this.loadViewsAsync()
      .then(() => callback())
      .catch((error) => callback(error));
  }

  async loadViewsAsync() {
    /* Loads files found in the *@config.views* directory and registers them as views. */
    if (this.config.views == null) {
      return;
    }
    const filenames = await fs.promises.readdir(this.resolvePath(this.config.views));
    const modules = filenames.map((filename) => `${this.config.views}/${filename}`);
    for (const mod of modules) {
      await new Promise((resolve, reject) => {
        this.loadViewModule(mod, (error) => (error ? reject(error) : resolve()));
      });
    }
  }

  getContents(callback) {
    this.getContentsAsync()
      .then((contents) => callback(null, contents))
      .catch((error) => callback(error));
  }

  async getContentsAsync() {
    /* Build the ContentTree from *@contentsPath*, also runs any registered generators. */
    const contents = await ContentTree.fromDirectoryAsync(this, this.contentsPath);
    const generated = [];
    for (const generator of this.generators) {
      const tree = await new Promise((resolve, reject) => {
        runGenerator(this, contents, generator, (error, result) => (error ? reject(error) : resolve(result)));
      });
      generated.push(tree);
    }

    if (generated.length === 0) {
      return contents;
    }

    const tree = new ContentTree('', this.getContentGroups());
    for (const gentree of generated) {
      ContentTree.merge(tree, gentree);
    }
    ContentTree.merge(tree, contents);
    return tree;
  }

  getTemplates(callback) {
    /* Load templates. */
    return loadTemplates(this, callback);
  }

  getLocals(callback) {
    /* Returns locals. */
    return callback(null, this.locals);
  }

  load(callback) {
    this.loadAsync()
      .then((result) => callback(null, result))
      .catch((error) => callback(error));
  }

  async loadAsync() {
    /* Convenience method to load plugins, views, contents, templates and locals. */
    await Promise.all([
      this.loadPluginsAsync(),
      this.loadViewsAsync()
    ]);

    const [contents, templates, locals] = await Promise.all([
      this.getContentsAsync(),
      new Promise((resolve, reject) => this.getTemplates((error, t) => (error ? reject(error) : resolve(t)))),
      Promise.resolve(this.locals)
    ]);

    return { contents, templates, locals };
  }

  preview(callback) {
    /* Start the preview server. Calls *callback* with the server instance when it is up and
       running or if an error occurs. NOTE: The returned server instance will be invalid if the
       config file changes and the server is restarted because of it. As a temporary workaround
       you can set the _restartOnConfChange key in settings to false. */
    this.mode = 'preview';
    const server = require('./server');
    return server.run(this, callback);
  }

  build(outputDir, callback) {
    this.buildAsync(outputDir, callback)
      .catch((error) => {
        if (typeof callback === 'function') {
          callback(error);
        }
      });
  }

  async buildAsync(outputDir, callback) {
    /* Build the content tree and render it to *outputDir*. */
    this.mode = 'build';
    if (typeof outputDir === 'function') {
      callback = outputDir;
      outputDir = this.resolvePath(this.config.output);
    } else {
      if (arguments.length < 2) {
        outputDir = this.resolvePath(this.config.output);
      }
      if (typeof callback !== 'function') {
        callback = function() {};
      }
    }
    try {
      const result = await this.loadAsync();
      const { contents, templates, locals } = result;
      render(this, outputDir, contents, templates, locals, callback);
    } catch (error) {
      callback(error);
    }
  }
}

Environment.create = function(config, workDir, log = logger) {
  /* Set up a new environment using the default logger, *config* can be
     either a config object, a Config instance or a path to a config file. */
  if (typeof config === 'string') {
    if (workDir == null) {
      workDir = path.dirname(config);
    }
    config = Config.fromFileSync(config);
  } else {
    if (workDir == null) {
      workDir = process.cwd();
    }
    if (!(config instanceof Config)) {
      config = new Config(config);
    }
  }
  return new Environment(config, workDir, log);
};

Environment.defaultPlugins = ['page', 'pug', 'markdown'];

module.exports = { Environment };

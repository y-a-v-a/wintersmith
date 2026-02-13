const fs = require('fs');
const path = require('path');
const url = require('url');
const chalk = require('chalk');
const minimatch = require('minimatch');

const minimatchOptions = { dot: false };
const defer = typeof setImmediate === 'function' ? setImmediate : process.nextTick;

class ContentPlugin {
  /* The mother of all plugins */

  static property(name, getter) {
    /* Define read-only property with *name*. */
    const get = typeof getter === 'string'
      ? function() { return this[getter](); }
      : function() { return getter.call(this); };
    Object.defineProperty(this.prototype, name, {
      get,
      enumerable: true
    });
  }

  getView() {
    /* Return a view that renders the plugin. Either a string naming a exisitng view or a function:
       `(env, locals, contents, templates, callback) ->`
       Where *environment* is the current coldsmith environment, *contents* is the content-tree
       and *templates* is a map of all templates as: {filename: templateInstance}. *callback* should be
       called with a stream/buffer or null if this plugin instance should not be rendered. */
    throw new Error('Not implemented.');
  }

  getFilename() {
    /* Return filename for this content. This is where the result of the plugin's view will be written to. */
    throw new Error('Not implemented.');
  }

  getUrl(base) {
    /* Return url for this content relative to *base*. */
    let filename = this.getFilename();
    if (base == null) {
      base = this.__env.config.baseUrl;
    }
    if (!base.match(/\/$/)) {
      base += '/';
    }
    if (process.platform === 'win32') {
      filename = filename.replace(/\\/g, '/');
    }
    return url.resolve(base, filename);
  }

  getPluginColor() {
    /* Return vanity color used to identify the plugin when printing the content tree
       choices are: bold, italic, underline, inverse, yellow, cyan, white, magenta,
       green, red, grey, blue, rainbow, zebra or none. */
    return 'cyan';
  }

  getPluginInfo() {
    /* Return plugin information. Also displayed in the content tree printout. */
    return `url: ${this.url}`;
  }

  static fromFile(_filepath, _callback) {
    /* Calls *callback* with an instance of class. Where *filepath* is an object containing
       both the absolute and realative paths for the file. e.g.
       {full: "/home/foo/mysite/contents/somedir/somefile.ext",
        relative: "somedir/somefile.ext"} */
    throw new Error('Not implemented.');
  }
}

ContentPlugin.property('view', 'getView');
ContentPlugin.property('filename', 'getFilename');
ContentPlugin.property('url', 'getUrl');
ContentPlugin.property('pluginColor', 'getPluginColor');
ContentPlugin.property('pluginInfo', 'getPluginInfo');

class StaticFile extends ContentPlugin {
  /* Static file handler, simply serves content as-is. Last in chain. */

  constructor(filepath) {
    super();
    this.filepath = filepath;
  }

  getView() {
    return (...args) => {
      const callback = args[args.length - 1];
      try {
        const rs = fs.createReadStream(this.filepath.full);
        return callback(null, rs);
      } catch (error) {
        return callback(error);
      }
    };
  }

  getFilename() {
    return this.filepath.relative;
  }

  getPluginColor() {
    return 'none';
  }

  static fromFile(filepath, callback) {
    return callback(null, new StaticFile(filepath));
  }
}

function loadContent(env, filepath, callback) {
  /* Helper that loads content plugin found in *filepath*. */
  env.logger.silly(`loading ${filepath.relative}`);
  let plugin = {
    class: StaticFile,
    group: 'files'
  };

  for (let i = env.contentPlugins.length - 1; i >= 0; i -= 1) {
    if (minimatch(filepath.relative, env.contentPlugins[i].pattern, minimatchOptions)) {
      plugin = env.contentPlugins[i];
      break;
    }
  }

  return plugin.class.fromFile(filepath, (error, instance) => {
    if (error != null) {
      error.message = `${filepath.relative}: ${error.message}`;
    }
    if (instance != null) {
      instance.__env = env;
      instance.__plugin = plugin;
      instance.__filename = filepath.full;
    }
    return callback(error, instance);
  });
}

class ContentTree {
  constructor(filename, groupNames = []) {
    let parent = null;
    const groups = {
      directories: [],
      files: []
    };
    for (const name of groupNames) {
      groups[name] = [];
    }

    Object.defineProperty(this, '__groupNames', {
      get() {
        return groupNames;
      }
    });

    Object.defineProperty(this, '_', {
      get() {
        return groups;
      }
    });

    Object.defineProperty(this, 'filename', {
      get() {
        return filename;
      }
    });

    Object.defineProperty(this, 'index', {
      get() {
        for (const key in this) {
          const item = this[key];
          if (key.slice(0, 6) === 'index.') {
            return item;
          }
        }
        return undefined;
      }
    });

    Object.defineProperty(this, 'parent', {
      get() {
        return parent;
      },
      set(val) {
        parent = val;
      }
    });
  }

  static async fromDirectoryAsync(env, directory) {
    /* Recursively scan *directory* and build a ContentTree with enviroment *env*. */
    const reldir = env.relativeContentsPath(directory);
    const tree = new ContentTree(reldir, env.getContentGroups());
    env.logger.silly(`creating content tree from ${directory}`);

    const filenames = await fs.promises.readdir(directory);
    filenames.sort();

    let resolved = filenames.map((filename) => {
      const relname = path.join(reldir, filename);
      return {
        full: path.join(env.contentsPath, relname),
        relative: relname
      };
    });

    if (env.config.ignore.length > 0) {
      resolved = resolved.filter((filename) => {
        for (const pattern of env.config.ignore) {
          if (minimatch(filename.relative, pattern, minimatchOptions)) {
            env.logger.verbose(`ignoring ${filename.relative} (matches: ${pattern})`);
            return false;
          }
        }
        return true;
      });
    }

    const createInstance = async (filepath) => {
      /* Create plugin or subtree instance for *filepath*. */
      await new Promise((resolve) => defer(resolve));
      const stats = await fs.promises.stat(filepath.full);
      const basename = path.basename(filepath.relative);
      if (stats.isDirectory()) {
        const result = await ContentTree.fromDirectoryAsync(env, filepath.full);
        result.parent = tree;
        tree[basename] = result;
        tree._.directories.push(result);
        return;
      }
      if (stats.isFile()) {
        await new Promise((resolve, reject) => {
          loadContent(env, filepath, (error, instance) => {
            if (error) {
              reject(error);
              return;
            }
            instance.parent = tree;
            tree[basename] = instance;
            tree._[instance.__plugin.group].push(instance);
            resolve();
          });
        });
        return;
      }
      throw new Error(`Invalid file ${filepath.full}.`);
    };

    await forEachLimit(resolved, env.config._fileLimit, createInstance);
    return tree;
  }

  static fromDirectory(env, directory, callback) {
    /* Recursively scan *directory* and build a ContentTree with enviroment *env*.
       Calls *callback* with a nested ContentTree or an error if something went wrong. */
    ContentTree.fromDirectoryAsync(env, directory)
      .then((tree) => callback(null, tree))
      .catch((error) => callback(error));
  }

  static inspect(tree, depth = 0) {
    /* Return a pretty formatted string representing the content *tree*. */
    if (typeof tree === 'number') {
      return '[Function: ContentTree]';
    }
    const rv = [];
    let pad = '';
    for (let i = 0; i <= depth; i += 1) {
      pad += '  ';
    }
    const keys = Object.keys(tree).sort((a, b) => {
      const ad = tree[a] instanceof ContentTree;
      const bd = tree[b] instanceof ContentTree;
      if (ad !== bd) {
        return bd - ad;
      }
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    for (const k of keys) {
      const v = tree[k];
      let s;
      if (v instanceof ContentTree) {
        s = `${chalk.bold(k)}/\n`;
        s += ContentTree.inspect(v, depth + 1);
      } else {
        let cfn = (input) => input;
        if (v.pluginColor !== 'none') {
          if (!(cfn = chalk[v.pluginColor])) {
            throw new Error(`Plugin ${k} specifies invalid pluginColor: ${v.pluginColor}`);
          }
        }
        s = `${cfn(k)} (${chalk.grey(v.pluginInfo)})`;
      }
      rv.push(pad + s);
    }
    return rv.join('\n');
  }

  static flatten(tree) {
    /* Return all the items in the *tree* as an array of content plugins. */
    let rv = [];
    for (const key in tree) {
      const value = tree[key];
      if (value instanceof ContentTree) {
        rv = rv.concat(ContentTree.flatten(value));
      } else {
        rv.push(value);
      }
    }
    return rv;
  }

  static merge(root, tree) {
    /* Merge *tree* into *root* tree. */
    for (const key in tree) {
      const item = tree[key];
      if (item instanceof ContentPlugin) {
        root[key] = item;
        item.parent = root;
        root._[item.__plugin.group].push(item);
      } else if (item instanceof ContentTree) {
        if (root[key] == null) {
          root[key] = new ContentTree(key, item.__groupNames);
          root[key].parent = root;
          root[key].parent._.directories.push(root[key]);
        }
        if (root[key] instanceof ContentTree) {
          ContentTree.merge(root[key], item);
        }
      } else {
        throw new Error(`Invalid item in tree for '${key}'`);
      }
    }
  }
}

function forEachLimit(items, limit, iterator) {
  return new Promise((resolve, reject) => {
    if (!items.length) {
      resolve();
      return;
    }
    let index = 0;
    let active = 0;
    let finished = false;

    const launch = () => {
      if (finished) {
        return;
      }
      if (index >= items.length && active === 0) {
        finished = true;
        resolve();
        return;
      }
      while (active < limit && index < items.length) {
        const item = items[index++];
        active += 1;
        Promise.resolve()
          .then(() => iterator(item))
          .then(() => {
            active -= 1;
            launch();
          })
          .catch((error) => {
            finished = true;
            reject(error);
          });
      }
    };

    launch();
  });
}

module.exports = {
  ContentTree,
  ContentPlugin,
  StaticFile,
  loadContent
};

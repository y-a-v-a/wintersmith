const chokidar = require('chokidar');
const chalk = require('chalk');
const http = require('http');
const mime = require('mime');
const url = require('url');
const minimatch = require('minimatch');
const enableDestroy = require('server-destroy');
const { Stream } = require('stream');

const { Config } = require('./config');
const { ContentTree } = require('./content');
const { pump } = require('./utils');
const { renderView } = require('./renderer');
const { runGenerator } = require('./generator');

function colorCode(code) {
  switch (Math.floor(code / 100)) {
    case 2:
      return chalk.green(code);
    case 4:
      return chalk.yellow(code);
    case 5:
      return chalk.red(code);
    default:
      return code.toString();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(anUrl) {
  if (anUrl[anUrl.length - 1] === '/') {
    anUrl += 'index.html';
  }
  if (anUrl.match(/^([^.]*[^\/])$/)) {
    anUrl += '/index.html';
  }
  return decodeURI(anUrl);
}

function urlEqual(urlA, urlB) {
  return normalizeUrl(urlA) === normalizeUrl(urlB);
}

function keyForValue(object, value) {
  for (const key in object) {
    if (object[key] === value) {
      return key;
    }
  }
  return null;
}

function replaceInArray(array, oldItem, newItem) {
  const idx = array.indexOf(oldItem);
  if (idx === -1) {
    return false;
  }
  array[idx] = newItem;
  return true;
}

function buildLookupMap(contents) {
  const map = {};
  for (const item of ContentTree.flatten(contents)) {
    map[normalizeUrl(item.url)] = item;
  }
  return map;
}

function lookupCharset(mimeType) {
  if (/^text\//.test(mimeType) || /^application\/(javascript|json)/.test(mimeType)) {
    return 'UTF-8';
  }
  return null;
}

function runGeneratorAsync(env, contents, generator) {
  return new Promise((resolve, reject) => {
    runGenerator(env, contents, generator, (error, tree) => (error ? reject(error) : resolve(tree)));
  });
}

function renderViewAsync(env, content, locals, contents, templates) {
  return new Promise((resolve, reject) => {
    renderView(env, content, locals, contents, templates, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });
  });
}

function setup(env) {
  /* Create a preview request handler. */
  let contents = null;
  let templates = null;
  let locals = null;
  let lookup = {};

  const block = {
    contentsLoad: false,
    templatesLoad: false,
    viewsLoad: false,
    localsLoad: false
  };

  const isReady = () => {
    /* Returns true if we have no running tasks */
    for (const k in block) {
      if (block[k] === true) {
        return false;
      }
    }
    return true;
  };

  const logop = (error) => {
    if (error != null) {
      return env.logger.error(error.message, error);
    }
  };

  const changeHandler = (error, filepath) => {
    /* Emits a change event if called without error */
    if (error == null) {
      env.emit('change', filepath, false);
    }
    return logop(error);
  };

  const loadContents = (callback = logop) => {
    block.contentsLoad = true;
    lookup = {};
    contents = null;
    ContentTree.fromDirectory(env, env.contentsPath, (error, result) => {
      if (error == null) {
        contents = result;
        lookup = buildLookupMap(result);
      }
      block.contentsLoad = false;
      return callback(error);
    });
  };

  const loadTemplates = (callback = logop) => {
    block.templatesLoad = true;
    templates = null;
    env.getTemplates((error, result) => {
      if (error == null) {
        templates = result;
      }
      block.templatesLoad = false;
      return callback(error);
    });
  };

  const loadViews = (callback = logop) => {
    block.viewsLoad = true;
    env.loadViews((error) => {
      block.viewsLoad = false;
      return callback(error);
    });
  };

  const loadLocals = (callback = logop) => {
    block.localsLoad = true;
    locals = null;
    env.getLocals((error, result) => {
      if (error == null) {
        locals = result;
      }
      block.localsLoad = false;
      return callback(error);
    });
  };

  const contentWatcher = chokidar.watch(env.contentsPath, { ignoreInitial: true });
  contentWatcher.on('all', (_type, filename) => {
    if (block.contentsLoad) {
      return;
    }
    const relpath = env.relativeContentsPath(filename);
    for (const pattern of env.config.ignore) {
      if (minimatch(relpath, pattern)) {
        env.emit('change', relpath, true);
        return;
      }
    }
    return loadContents((error) => {
      let contentFilename = null;
      if (error == null && filename != null) {
        for (const content of ContentTree.flatten(contents)) {
          if (content.__filename === filename) {
            contentFilename = content.filename;
            break;
          }
        }
      }
      return changeHandler(error, contentFilename);
    });
  });

  const templateWatcher = chokidar.watch(env.templatesPath, { ignoreInitial: true });
  templateWatcher.on('all', () => {
    if (!block.templatesLoad) {
      return loadTemplates(changeHandler);
    }
  });

  let viewsWatcher = null;
  if (env.config.views != null) {
    viewsWatcher = chokidar.watch(env.resolvePath(env.config.views), { ignoreInitial: true });
    viewsWatcher.on('all', (_event, filepath) => {
      if (!block.viewsLoad) {
        delete require.cache[filepath];
        return loadViews(changeHandler);
      }
    });
  }

  const contentHandler = async (request, response) => {
    const uri = normalizeUrl(url.parse(request.url).pathname);
    env.logger.verbose(`contentHandler - ${uri}`);

    const generated = [];
    for (const generator of env.generators) {
      generated.push(await runGeneratorAsync(env, contents, generator));
    }

    let tree = contents;
    let generatorLookup = {};
    if (generated.length > 0) {
      try {
        tree = new ContentTree('', env.getContentGroups());
        for (const gentree of generated) {
          ContentTree.merge(tree, gentree);
        }
        generatorLookup = buildLookupMap(generated);
        ContentTree.merge(tree, contents);
      } catch (error) {
        return { error };
      }
    }

    const content = generatorLookup[uri] || lookup[uri];
    if (content == null) {
      return { handled: false };
    }

    const pluginName = content.constructor.name;
    try {
      const result = await renderViewAsync(env, content, locals, tree, templates);
      if (result != null) {
        const mimeType = mime.getType(content.filename) ?? mime.getType(uri);
        const charset = lookupCharset(mimeType);
        const contentType = charset ? `${mimeType}; charset=${charset}` : mimeType;

        if (result instanceof Stream) {
          response.writeHead(200, { 'Content-Type': contentType });
          await new Promise((resolve, reject) => {
            pump(result, response, (err) => (err ? reject(err) : resolve()));
          });
          return { handled: true, responseCode: 200, pluginName };
        }

        if (result instanceof Buffer) {
          response.writeHead(200, { 'Content-Type': contentType });
          response.write(result);
          response.end();
          return { handled: true, responseCode: 200, pluginName };
        }

        return { error: new Error(`View for content '${content.filename}' returned invalid response. Expected Buffer or Stream.`), pluginName };
      }

      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('404 Not Found\n');
      return { handled: true, responseCode: 404, pluginName };
    } catch (error) {
      return { error, pluginName };
    }
  };

  const requestHandler = async (request, response) => {
    const start = Date.now();
    const uri = url.parse(request.url).pathname;

    try {
      if (!block.contentsLoad && contents == null) {
        await new Promise((resolve, reject) => loadContents((err) => (err ? reject(err) : resolve())));
      }
      if (!block.templatesLoad && templates == null) {
        await new Promise((resolve, reject) => loadTemplates((err) => (err ? reject(err) : resolve())));
      }
      while (!isReady()) {
        await sleep(50);
      }

      const result = await contentHandler(request, response);
      let responseCode = result?.responseCode;
      const pluginName = result?.pluginName;

      if (result?.error != null || responseCode == null || result?.handled === false) {
        responseCode = result?.error != null ? 500 : 404;
        response.writeHead(responseCode, { 'Content-Type': 'text/plain' });
        response.end(result?.error != null ? result.error.message : '404 Not Found\n');
      }

      const delta = Date.now() - start;
      let logstr = `${colorCode(responseCode)} ${chalk.bold(uri)}`;
      if (pluginName != null) {
        logstr += ` ${chalk.grey(pluginName)}`;
      }
      logstr += chalk.grey(` ${delta}ms`);
      env.logger.info(logstr);
      if (result?.error) {
        env.logger.error(result.error.message, result.error);
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(error.message);
      env.logger.error(error.message, error);
    }
  };

  loadContents();
  loadTemplates();
  loadViews();
  loadLocals();

  requestHandler.destroy = () => {
    contentWatcher.close();
    templateWatcher.close();
    if (viewsWatcher != null) {
      viewsWatcher.close();
    }
  };

  return requestHandler;
}

function run(env, callback) {
  let server = null;
  let handler = null;
  let configWatcher = null;

  const start = async () => {
    await new Promise((resolve, reject) => {
      env.loadPlugins((error) => (error ? reject(error) : resolve()));
    });

    handler = setup(env);
    server = http.createServer(handler);
    enableDestroy(server);

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };
      server.on('error', onError);
      server.on('listening', onListening);
      server.listen(env.config.port, env.config.hostname);
    });

    return server;
  };

  const stop = async () => {
    if (server == null) {
      return;
    }
    await new Promise((resolve, reject) => {
      server.destroy((error) => (error ? reject(error) : resolve()));
    });
    handler.destroy();
    env.reset();
  };

  const restart = async () => {
    env.logger.info('restarting server');
    await stop();
    await start();
  };

  if (env.config._restartOnConfChange && env.config.__filename != null) {
    env.logger.verbose(`watching config file ${env.config.__filename} for changes`);
    configWatcher = chokidar.watch(env.config.__filename);
    configWatcher.on('change', async () => {
      let config;
      try {
        config = Config.fromFileSync(env.config.__filename);
      } catch (error) {
        env.logger.error(`Error reloading config: ${error.message}`, error);
      }
      if (config != null) {
        const cliopts = env.config._cliopts;
        if (cliopts) {
          config._cliopts = {};
          for (const key in cliopts) {
            const value = cliopts[key];
            config[key] = config._cliopts[key] = value;
          }
        }
        env.setConfig(config);
        try {
          await restart();
          env.logger.verbose('config file change detected, server reloaded');
          env.emit('change');
        } catch (error) {
          env.logger.error(error.message, error);
        }
      }
    });
  }

  process.on('uncaughtException', (error) => {
    env.logger.error(error.message, error);
    process.exit(1);
  });

  env.logger.verbose('starting preview server');
  start()
    .then((serverInstance) => {
      const host = env.config.hostname || 'localhost';
      const serverUrl = `http://${host}:${env.config.port}${env.config.baseUrl}`;
      env.logger.info(`server running on: ${chalk.bold(serverUrl)}`);
      callback(null, serverInstance);
    })
    .catch((error) => callback(error));
}

module.exports = { run, setup, normalizeUrl, urlEqual, keyForValue, replaceInArray };

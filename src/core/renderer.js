const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const { Stream } = require('stream');

const { ContentTree } = require('./content');
const { pump, extend } = require('./utils');

const defer = typeof setImmediate === 'function' ? setImmediate : process.nextTick;

function renderView(env, content, locals, contents, templates, callback) {
  return defer(() => {
    const _locals = { env, contents };
    extend(_locals, locals);

    let view = content.view;
    if (typeof view === 'string') {
      const name = view;
      view = env.views[view];
      if (view == null) {
        callback(new Error(`content '${content.filename}' specifies unknown view '${name}'`));
        return;
      }
    }

    return view.call(content, env, _locals, contents, templates, (error, result) => {
      if (error != null) {
        error.message = `${content.filename}: ${error.message}`;
      }
      return callback(error, result);
    });
  });
}

function forEachLimit(items, limit, iterator, callback) {
  if (!items.length) {
    callback();
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
      callback();
      return;
    }
    while (active < limit && index < items.length) {
      const item = items[index++];
      active += 1;
      iterator(item, (error) => {
        if (finished) {
          return;
        }
        if (error) {
          finished = true;
          callback(error);
          return;
        }
        active -= 1;
        launch();
      });
    }
  };

  launch();
}

function render(env, outputDir, contents, templates, locals, callback) {
  /* Render *contents* and *templates* using environment *env* to *outputDir*.
     The output directory will be created if it does not exist. */
  env.logger.info(`rendering tree:\n${ContentTree.inspect(contents, 1)}\n`);
  env.logger.verbose(`render output directory: ${outputDir}`);

  const renderPlugin = (content, cb) => {
    /* render *content* plugin, calls *callback* with true if a file is written; otherwise false. */
    return renderView(env, content, locals, contents, templates, (error, result) => {
      if (error) {
        return cb(error);
      }
      if (result instanceof Stream || result instanceof Buffer) {
        const destination = path.join(outputDir, content.filename);
        env.logger.verbose(`writing content ${content.url} to ${destination}`);
        mkdirp.sync(path.dirname(destination));
        const writeStream = fs.createWriteStream(destination);
        if (result instanceof Stream) {
          return pump(result, writeStream, cb);
        }
        return writeStream.end(result, cb);
      }
      env.logger.verbose(`skipping ${content.url}`);
      return cb();
    });
  };

  const items = ContentTree.flatten(contents);
  return forEachLimit(items, env.config._fileLimit, renderPlugin, callback);
}

module.exports = { render, renderView };

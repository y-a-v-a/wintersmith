const fs = require('fs');
const pug = require('pug');

module.exports = function(env, callback) {
  class PugTemplate extends env.TemplatePlugin {
    constructor(fn) {
      super();
      this.fn = fn;
    }

    render(locals, cb) {
      try {
        return cb(null, Buffer.from(this.fn(locals)));
      } catch (error) {
        return cb(error);
      }
    }

    static fromFile(filepath, cb) {
      fs.promises.readFile(filepath.full)
        .then((buffer) => {
          const conf = env.config.pug || {};
          conf.filename = filepath.full;
          const rv = pug.compile(buffer.toString(), conf);
          return cb(null, new PugTemplate(rv));
        })
        .catch((error) => cb(error));
    }
  }

  env.registerTemplatePlugin('**/*.*(pug|jade)', PugTemplate);
  return callback();
};

const fs = require('fs');
const path = require('path');

const fileExists = fs.exists || path.exists;
const fileExistsSync = fs.existsSync || path.existsSync;

function extend(obj, mixin) {
  for (const name in mixin) {
    obj[name] = mixin[name];
  }
}

function stripExtension(filename) {
  /* Remove the file-extension from *filename* */
  return filename.replace(/(.+)\.[^.]+$/, '$1');
}

async function readJSONAsync(filename) {
  const buffer = await fs.promises.readFile(filename);
  try {
    return JSON.parse(buffer.toString());
  } catch (error) {
    error.filename = filename;
    error.message = `parsing ${path.basename(filename)}: ${error.message}`;
    throw error;
  }
}

function readJSON(filename, callback) {
  /* Read and try to parse *filename* as JSON, *callback* with parsed object or error on fault. */
  readJSONAsync(filename)
    .then((data) => callback(null, data))
    .catch((error) => callback(error));
}

function readJSONSync(filename) {
  /* Synchronously read and try to parse *filename* as json. */
  const buffer = fs.readFileSync(filename);
  return JSON.parse(buffer.toString());
}

async function readdirRecursiveAsync(directory) {
  /* Returns an array representing *directory*, including subdirectories. */
  const result = [];

  const walk = async (dir) => {
    const filenames = await fs.promises.readdir(path.join(directory, dir));
    for (const filename of filenames) {
      const relname = path.join(dir, filename);
      const stat = await fs.promises.stat(path.join(directory, relname));
      if (stat.isDirectory()) {
        await walk(relname);
      } else {
        result.push(relname);
      }
    }
  };

  await walk('');
  return result;
}

function readdirRecursive(directory, callback) {
  readdirRecursiveAsync(directory)
    .then((result) => callback(null, result))
    .catch((error) => callback(error));
}

function pump(source, destination, callback) {
  /* Pipe *source* stream to *destination* stream calling *callback* when done */
  source.pipe(destination);
  source.on('error', (error) => {
    if (typeof callback === 'function') {
      callback(error);
    }
    callback = null;
  });
  destination.on('finish', () => {
    if (typeof callback === 'function') {
      callback();
    }
    callback = null;
  });
}

function rfc822(date) {
  /* return a rfc822 representation of a javascript Date object
     http://www.w3.org/Protocols/rfc822/#z28 */
  const pad = (i) => (i < 10 ? `0${i}` : `${i}`);
  const tzoffset = (offset) => {
    const hours = Math.floor(offset / 60);
    const minutes = Math.abs(offset % 60);
    const direction = hours > 0 ? '-' : '+';
    return `${direction}${pad(Math.abs(hours))}${pad(minutes)}`;
  };
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', ' Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  return [
    `${days[date.getDay()]},`,
    pad(date.getDate()),
    months[date.getMonth()],
    date.getFullYear(),
    time,
    tzoffset(date.getTimezoneOffset())
  ].join(' ');
}

module.exports = {
  fileExists,
  fileExistsSync,
  extend,
  stripExtension,
  readJSON,
  readJSONSync,
  readdirRecursive,
  pump,
  rfc822
};

const fs = require('fs');
const hljs = require('highlight.js');
const marked = require('marked');
const url = require('url');
const yaml = require('js-yaml');

if (marked.InlineLexer.prototype._outputLink == null) {
  marked.InlineLexer.prototype._outputLink = marked.InlineLexer.prototype.outputLink;
  marked.InlineLexer.prototype._resolveLink = function(href) {
    return href;
  };
  marked.InlineLexer.prototype.outputLink = function(cap, link) {
    link.href = this._resolveLink(link.href);
    return this._outputLink(cap, link);
  };
}

function resolveLink(content, uri, baseUrl) {
  /* Resolve *uri* relative to *content*, resolves using
     *baseUrl* if no matching content is found. */
  const uriParts = url.parse(uri);
  if (uriParts.protocol) {
    return uri;
  }
  if (uriParts.hash === uri) {
    return uri;
  }

  let nav = content.parent;
  const pathParts = (uriParts.pathname ? uriParts.pathname.split('/') : []) || [];
  while (pathParts.length && nav != null) {
    const part = pathParts.shift();
    if (part === '') {
      while (nav.parent) {
        nav = nav.parent;
      }
    } else if (part === '..') {
      nav = nav.parent;
    } else {
      nav = nav[part];
    }
  }
  if (nav?.getUrl != null) {
    return nav.getUrl() + [uriParts.hash];
  }
  return url.resolve(baseUrl, uri);
}

function parseMarkdownSync(content, markdown, baseUrl, options) {
  /* Parse *markdown* found on *content* node of contents and
     resolve links by navigating in the content tree. use *baseUrl* as a last resort
     returns html. */
  marked.InlineLexer.prototype._resolveLink = function(uri) {
    return resolveLink(content, uri, baseUrl);
  };

  options.highlight = (code, lang) => {
    try {
      if (lang === 'auto') {
        return hljs.highlightAuto(code).value;
      }
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
    } catch (_error) {
      return code;
    }
    return code;
  };

  marked.setOptions(options);
  return marked(markdown);
}

function readFileAsync(filepath) {
  return fs.promises.readFile(filepath.full).then((buffer) => buffer.toString());
}

module.exports = function(env, callback) {
  const hljsConfigDefaults = { classPrefix: '' };
  const hljsConfig = env.config.highlightjs || {};
  for (const key in hljsConfigDefaults) {
    if (hljsConfig[key] == null) {
      hljsConfig[key] = hljsConfigDefaults[key];
    }
  }
  hljs.configure(hljsConfig);

  class MarkdownPage extends env.plugins.Page {
    constructor(filepath, metadata, markdown) {
      super();
      this.filepath = filepath;
      this.metadata = metadata;
      this.markdown = markdown;
    }

    getLocation(base) {
      const uri = this.getUrl(base);
      return uri.slice(0, uri.lastIndexOf('/') + 1 || 9e9);
    }

    getHtml(base = env.config.baseUrl) {
      /* parse @markdown and return html. also resolves any relative urls to absolute ones */
      const options = env.config.markdown || {};
      return parseMarkdownSync(this, this.markdown, this.getLocation(base), options);
    }
  }

  MarkdownPage.fromFile = function(filepath, cb) {
    readFileAsync(filepath)
      .then((content) => MarkdownPage.extractMetadataAsync(content))
      .then((result) => {
        const { markdown, metadata } = result;
        const page = new MarkdownPage(filepath, metadata, markdown);
        cb(null, page);
      })
      .catch((error) => cb(error));
  };

  MarkdownPage.extractMetadataAsync = async function(content) {
    const parseMetadata = (source) => {
      if (!(source.length > 0)) {
        return {};
      }
      try {
        return yaml.load(source) || {};
      } catch (error) {
        if (error.problem != null && error.problemMark != null) {
          const lines = error.problemMark.buffer.split('\n');
          const markerPad = ' '.repeat(error.problemMark.column);
          error.message = `YAML: ${error.problem}\n\n${lines[error.problemMark.line]}\n${markerPad}^\n`;
        } else {
          error.message = `YAML Parsing error ${error.message}`;
        }
        throw error;
      }
    };

    let metadata = '';
    let markdown = content;
    if (content.slice(0, 3) === '---') {
      const result = content.match(/^-{3,}\s([\s\S]*?)-{3,}(\s[\s\S]*|\s?)$/);
      if ((result?.length || 0) === 3) {
        metadata = result[1];
        markdown = result[2];
      }
    } else if (content.slice(0, 12) === '```metadata\n') {
      const end = content.indexOf('\n```\n');
      if (end !== -1) {
        metadata = content.substring(12, end);
        markdown = content.substring(end + 5);
      }
    }

    return {
      metadata: parseMetadata(metadata),
      markdown
    };
  };

  MarkdownPage.resolveLink = resolveLink;

  class JsonPage extends MarkdownPage {
    /* Plugin that allows pages to be created with just metadata form a JSON file */
  }

  JsonPage.fromFile = function(filepath, cb) {
    env.utils.readJSON(filepath.full, (error, metadata) => {
      if (error) {
        cb(error);
        return;
      }
      const markdown = metadata.content || '';
      const page = new JsonPage(filepath, metadata, markdown);
      cb(null, page);
    });
  };

  env.registerContentPlugin('pages', '**/*.*(markdown|mkd|md)', MarkdownPage);
  env.registerContentPlugin('pages', '**/*.json', JsonPage);
  return callback();
};

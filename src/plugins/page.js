const path = require('path');
const slugify = require('slugg');

function replaceAll(string, map) {
  const re = new RegExp(Object.keys(map).join('|'), 'gi');
  return string.replace(re, (match) => map[match]);
}

module.exports = function(env, callback) {
  const templateView = function(_env, locals, _contents, templates, cb) {
    /* Content view that expects content to have a @template instance var that
       matches a template in *templates*. Calls *callback* with output of template
       or null if @template is set to 'none'. */
    if (this.template === 'none') {
      return cb(null, null);
    }
    const template = templates[path.normalize(this.template)];
    if (template == null) {
      cb(new Error(`page '${this.filename}' specifies unknown template '${this.template}'`));
      return;
    }
    const ctx = { page: this };
    env.utils.extend(ctx, locals);
    return template.render(ctx, cb);
  };

  class Page extends env.ContentPlugin {
    /* Page base class, a page is content that has metadata, html and a template that renders it */
    constructor(filepath, metadata) {
      super();
      this.filepath = filepath;
      this.metadata = metadata;
    }

    getFilename() {
      /* Returns the filename for this page based on the filename template.
         The default template (filenameTemplate config key) is ':file.html'.

         Available variables:

           :year - Full year from page.date
           :month - Zero-padded month from page.date
           :day - Zero-padded day from page.date
           :title - Slugified version of page.title
           :basename - filename from @filepath
           :file - basename without file extension
           :ext - file extension

         You can also run javascript by wrapping it in double moustaches {{ }}, in that context
         this page instance is available as *page* and the environment as *env*.

         Examples:

           (for a page with the filename somedir/myfile.md and date set to 2001-02-03)

           template: :file.html (default)
           output: somedir/myfile.html

           template: /:year/:month/:day/index.html
           output: 2001/02/03/index.html

           template: :year-:title.html
           output: somedir/2001-slugified-title.html

           template: /otherdir/{{ page.metadata.category }}/:basename
           output: otherdir/the-category/myfile.md
      */
      const template = this.filenameTemplate;
      const dirname = path.dirname(this.filepath.relative);
      const basename = path.basename(this.filepath.relative);
      const file = env.utils.stripExtension(basename);
      const ext = path.extname(basename);

      let filename = replaceAll(template, {
        ':year': this.date.getFullYear(),
        ':month': `0${this.date.getMonth() + 1}`.slice(-2),
        ':day': `0${this.date.getDate()}`.slice(-2),
        ':title': slugify(`${this.title}`),
        ':file': file,
        ':ext': ext,
        ':basename': basename,
        ':dirname': dirname
      });

      let vm = null;
      let ctx = null;
      filename = filename.replace(/\{\{(.*?)\}\}/g, (match, code) => {
        if (vm == null) {
          vm = require('vm');
        }
        if (ctx == null) {
          ctx = vm.createContext({ env, page: this });
        }
        return vm.runInContext(code, ctx);
      });

      if (filename[0] === '/') {
        return filename.slice(1);
      }
      return path.join(dirname, filename);
    }

    getUrl(base) {
      return super.getUrl(base).replace(/([\/^])index\.html$/, '$1');
    }

    getView() {
      return this.metadata.view || 'template';
    }

    /* Page specific properties */

    getHtml(base = env.config.baseUrl) {
      /* return html with all urls resolved using *base* */
      throw new Error('Not implemented.');
    }

    getIntro(base) {
      const html = this.getHtml(base);
      const cutoffs = env.config.introCutoffs || ['<span class="more', '<h2', '<hr'];
      let idx = Number.POSITIVE_INFINITY;
      for (const cutoff of cutoffs) {
        const i = html.indexOf(cutoff);
        if (i !== -1 && i < idx) {
          idx = i;
        }
      }
      if (idx !== Number.POSITIVE_INFINITY) {
        return html.substr(0, idx);
      }
      return html;
    }

    getFilenameTemplate() {
      return this.metadata.filename || env.config.filenameTemplate || ':file.html';
    }

    /* Template property used by the 'template' view */
    getTemplate() {
      return this.metadata.template || env.config.defaultTemplate || 'none';
    }
  }

  Page.property('html', 'getHtml');
  Page.property('intro', 'getIntro');
  Page.property('filenameTemplate', 'getFilenameTemplate');
  Page.property('template', 'getTemplate');
  Page.property('title', function() {
    return this.metadata.title || 'Untitled';
  });
  Page.property('date', function() {
    return new Date(this.metadata.date || 0);
  });
  Page.property('rfc822date', function() {
    return env.utils.rfc822(this.date);
  });
  Page.property('hasMore', function() {
    if (this._html == null) {
      this._html = this.getHtml();
    }
    if (this._intro == null) {
      this._intro = this.getIntro();
    }
    if (this._hasMore == null) {
      this._hasMore = this._html.length > this._intro.length;
    }
    return this._hasMore;
  });

  env.plugins.Page = Page;
  env.registerView('template', templateView);
  return callback();
};

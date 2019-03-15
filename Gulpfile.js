var gulp = require('gulp');
var src = gulp.src;
var dest = gulp.dest;
var series = gulp.series;
var parallel = gulp.parallel;
var watch = gulp.watch;
var del = require('del');
var compileLess = require('gulp-less');
var rename = require('gulp-rename');
var svgstore = require('gulp-svgstore');
var svgmin = require('gulp-svgmin');
var async = require('async');
var mkdirp = require('mkdirp');
var fs = require('fs');
var getDirName = require('path').dirname;

const clean = function() {
  return del([
    'dist/**/*'
  ]);
}

const js = function() {
  return src('src/js/*.+(js|map)').pipe(dest('dist/viewer-assets/js'));
}

const css = function() {
  return src('src/css/*.css').pipe(dest('dist/viewer-assets/css'));
}

const fonts = function() {
  return src(['src/fonts/*.+(woff|woff2|ttf|otf)', 'src/fonts/*LICENSE*']).pipe(dest('dist/viewer-assets/fonts'));
}

const img = function() {
  return src('src/img/*.+(png|gif|jpg|jpeg|cur)').pipe(dest('dist/viewer-assets/img'));
}

const viewerCore = function() {
  return src('node_modules/@prizmdoc/viewer-core/viewercontrol.js').pipe(dest('dist/viewer-assets/js'))
}

const icons = function() {
  return src('src/icons/svg/*.svg')
    .pipe(rename({
      prefix: 'pcc-icon-'
    }))
    .pipe(svgmin())
    .pipe(svgstore())
    .pipe(rename('svg-icons.svg'))
    .pipe(dest('dist/viewer-assets/icons'));
}

const less = function() {
  return src(['src/less/viewer.less', 'src/less/fonts.less', 'src/less/legacy.less'])
    .pipe(compileLess())
    .pipe(dest('dist/viewer-assets/css'));
}

const viewerCustomizationsJs = series(icons, function viewerCustomizationsJs(done) {
  function writeFile(path, contents, cb) {
    mkdirp(getDirName(path), function (err) {
      if (err) {
        return cb(err);
      }
      fs.writeFile(path, contents, cb);
    });
  };

  const createIconSvgObject = function(callback) {
    fs.readFile('dist/viewer-assets/icons/svg-icons.svg', function(err, data) {
      if (err) {
        return callback(err);
      }
      callback(null, data.toString());
    });
  }

  function createLanguagesObject(callback) {
    fs.readdir('src/languages', function(err, files) {
      if (err) {
        return callback(err);
      }
      var languages = {};
      files.forEach(function (filePath) {
        if (filePath.endsWith('.json')) {
          var contents = fs.readFileSync('src/languages/' + filePath).toString();
          languages[filePath.replace('.json', '')] = JSON.parse(contents);
        }
      });
      return callback(null, languages);
    });
  }

  function createHtmlTemplatesObject(callback) {
    fs.readdir('src/templates', function(err, files) {
      if (err) {
        return callback(err);
      }
      var htmlTemplates = {};
      files.forEach(function (filePath) {
        if (filePath.endsWith('.html')) {
          var contents = fs.readFileSync('src/templates/' + filePath).toString()
            .replace(/\n|\r|\t/g, ' ') // convert all whitespace to space characters
            .replace(/\s\s+/g, ' ') // eliminate multiple spaces in a row
            .trim()

          htmlTemplates[filePath.replace('Template.html', '')] = contents;
        }
      });
      return callback(null, htmlTemplates);
    });
  }

  async.parallel({
    languages: createLanguagesObject,
    template: createHtmlTemplatesObject,
    icons: createIconSvgObject
  }, createViewerCustomizationsFile);

  function createViewerCustomizationsFile(err, results) {
    if (err) {
      return done(err);
    }
    var customizations = {
      languages: results['languages'],
      template: results['template'],
      icons: results['icons']
    }
    var jsObject = JSON.stringify(customizations, null, 2).replace(/<\/script>/g, '\\74/script>'); // escape closing </script> tags so they can be safely embedded
    var jsFileContents = 'window.viewerCustomizations = ' + jsObject + ';';
    writeFile('dist/viewer-assets/js/viewerCustomizations.js', jsFileContents, function (err) {
      if (err) {
        return done(err);
      }
      done();
    });
  }
});

const build = series(clean, parallel(
  less, css, fonts, img,  js, viewerCustomizationsJs, viewerCore
));

const watchTask = series(build, function registerWatchRules(done) {
  watch('src/css/**/*', css);
  watch('src/less/**/*.less', less);
  watch('src/fonts/**/*', fonts);
  watch('src/img/**/*', img);
  watch('src/icons/svg/*.svg', icons);
  watch(['src/languages/*.json', 'src/templates/*.html', 'src/icons/svg-icons.svg'], viewerCustomizationsJs);
  watch('src/js/*.js', js);
  done();
});

exports.clean = clean;
exports.build = build;
exports.watch = watchTask;
exports.default = build;

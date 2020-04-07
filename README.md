# PrizmDoc Viewer Client Assets Build

Source code and build script for the [PrizmDoc Viewer] HTML, CSS, and JavaScript
client assets, intended primarily for customers who need fine-grained control of
the viewer's look and feel.

The [PrizmDoc Viewer] web application samples already have a copy of the
pre-built HTML, CSS, and JavaScript assets needed for the viewer to function.
**This repository contains the original, un-built client source code (layout
templates, LESS style rules, SVG icon definitions, and language strings) as well
as the build script which compiles this source into HTML, CSS, and JavaScript
assets for use in your web application.** If you need fine-grained control over
your viewer's look and feel, you can clone this repository locally and use it as
a starting point to build a custom version of the viewer's HTML, CSS, and
JavaScript client assets.

## Building client assets

The build compiles the files in `src/` and outputs assets in the `dist/`
directory.

### Setting up to build for the first time

First, make sure you have `npm` installed.

Then, in your copy of this directory, ensure all of the necessary build
dependencies are installed with:

```
npm install
```

### Building your changes

You can do a one-time build of your changes with:

```
npm run build
```

Or you can watch for changes and automatically run a development build on each
change with:

```
npm run watch
```

## Integrating the viewer into your web application

### Copy the client assets to your web application

Make a copy of the `viewer-assets` directory within `dist/` that was created
during the build and place it somewhere inside of your web application. For
example, in the root of your project, create a new directory named `viewer` and
copy the contents of this directory into it.

### Expose the `css`, `js`, and `icons` subdirectories as static content in your web application

The `dist/viewer-assets/` subdirectories `css`, `js`, and `icons` contain static
files that will need to be delivered to the browser, so you'll want to configure
your web application to expose those files as static content.

### Setup a proxy through your web server to PrizmDoc

The viewer needs to make HTTP requests to PrizmDoc for document content, and the
best way to do this is by letting your web server _proxy_ those requests (as
opposed to using CORS, which would prevent you from being able to use
Accusoft-hosted PrizmDoc).

There are lots of ways you can go about setting this up, but here's a simple
example of what you might do with a node express app:

```js
let proxy = httpProxyMiddleware('/prizmdoc', {
  target: 'https://api.accusoft.com',
  changeOrigin: true, // necessary if converting from HTTP to HTTPS
  headers: { 'acs-api-key': 'PUT_YOUR_ACCUSOFT_API_KEY_HERE' }, // required for Accusoft-hosted PrizmDoc
  logLevel: 'debug'
});
app.use(proxy);
```

If you're using Accusoft-hosted PrizmDoc, make sure to enter your `acs-api-key`.
If you're self-hosting PrizmDoc, you don't need to inject the `acs-api-key`
header.

### Setup your HTML `<head>`

To make sure the viewer works well across different browsers and devices, ensure
these tags in the `<head>` section of your page:

```html
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1 user-scalable=no"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
```

Next, include the required CSS. This example assumes your web application has
been configured to map requests to `viewer/css/...` to the `css` subdirectory:

```html
<link rel="stylesheet" href="viewer/css/normalize.min.css">
<link rel="stylesheet" href="viewer/css/viewercontrol.css">
<link rel="stylesheet" href="viewer/css/viewer.css">
```

Finally, include the required JavaScript files. This example assumes your web
application has been configured to map requests to `viewer/js/...` to the `js`
subdirectory:

```html
<script src="viewer/js/jquery-3.4.1.min.js"></script>
<script src="viewer/js/jquery.hotkeys.min.js"></script>
<script src="viewer/js/underscore.min.js"></script>
<script src="viewer/js/viewercontrol.js"></script>
<script src="viewer/js/viewer.js"></script>
<script src="viewer/js/viewerCustomizations.js"></script>
```

### Creating a viewer

Whenever your web application serves a page containing the viewer, it is your
application's responsibility to first send a POST to PrizmDoc to create a
_viewing session_ for the source document that will be viewed. The initial POST
to create a viewing session is fast and will return a `viewingSessionId`, a
critical piece of data which you will need to render into the HTML that is sent
to the browser.

In the browser, you use the `pccViewer` jquery plugin function to convert a
particular `div` on your page into an actual viewer that is tied to a given
`viewingSessionId` (you pass the `viewingSessionId` to the `documentID` option).

If you are using a server-side HTML templating language, your view code to
initialize the viewer will look something like this:

```html
<script type="text/javascript">
  $(function() {
    $('#myDiv').pccViewer({
      documentID: '<%= viewingSessionId %>',
      imageHandlerUrl: '/prizmdoc',
      viewerAssetsPath: 'viewer',
      language: viewerCustomizations.languages['en-US'],
      template: viewerCustomizations.template,
      icons: viewerCustomizations.icons,
      annotationsMode: 'LayeredAnnotations'
    });
  });
</script>
```

Let's explain the various parts of this function call:

- `documentID` is assigned the `viewingSessionId` for the PrizmDoc viewing session your web application just created.
- `imageHandlerUrl` is the base route you setup earlier to proxy requests to PrizmDoc. The viewer will use this base route for all requests it makes for document content.
- `viewerAssetsPath` is the base route to get the static CSS and JavaScript (e.g. `viewer/css/...` and `viewer/js/...`) assets. This is used by the viewer at print time.
- `language`, `template`, and `icons` are how pre-built viewer customizations are passed in. You can effectively treat this as boilerplate.
- `annotationsMode` is set to `'LayeredAnnotations'` so that the viewer saves and loads annotation data in our newer JSON markup format.

## Customizing your viewer

Many customers are happy with the out-of-box appearance and layout of the viewer
and don't need to make changes to it. However, if you're not, you can completely
change the viewer's:

- UI layout (HTML templates, located in `src/templates/`)
- Icons (located in `src/icons/svg/`)
- Localized text strings (located in the JSON files in `src/languages/`)
- LESS-based style rules (located in `src/less/`)

If you change any of the above, you will need to re-build the client assets and
copy the new `dist` output into your web application. You might choose to put
the source code of this repository somewhere in your web application and then
configure your own build scripts to run this build and copy the new `dist`
output into the place where your web application needs it.

[PrizmDoc Viewer]: https://www.accusoft.com/products/prizmdoc/overview/

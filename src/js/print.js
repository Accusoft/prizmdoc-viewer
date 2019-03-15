"use strict";
var el = document.querySelector('#print');

var options = JSON.parse(el.getAttribute('data-options'));
options.pages = options.pages.split(',');

PCCViewer.PrintControl(document.body, options);

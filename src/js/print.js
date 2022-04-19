// Copyright (C) 1996-2022 Accusoft Corporation
// See https://github.com/Accusoft/prizmdoc-viewer/blob/master/LICENSE

"use strict";
var el = document.querySelector('#print');

var options = JSON.parse(el.getAttribute('data-options'));
options.pages = options.pages.split(',');

PCCViewer.PrintControl(document.body, options);

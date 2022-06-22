// Copyright (C) 1996-2022 Accusoft Corporation
// See https://github.com/Accusoft/prizmdoc-viewer/blob/master/LICENSE

//---------------------------------------------------------------------------------------------------------------------
//
//  This file will be updated with future releases of the product. To make merging future updates easier, we strongly
//  recommend you minimize the changes you make to this specific file, keeping your own code in separate
//  files whenever you can.
//
//---------------------------------------------------------------------------------------------------------------------

/* jshint devel: false, unused: false */
/* global jQuery, _ */

var PCCViewer = window.PCCViewer || {};

(function($, undefined) {
    'use strict';

    // Use this key to get or set the viewer object associated with DOM element in which the viewer is embedded.
    var DATAKEY = "PCCViewer.Viewer";

    // Track all of the window resize callbacks so they can be detatched
    // when the viewer is destroyed.
    var windowResizeCallbacks = [];

    // onWindowResize
    // Attach the supplied callback to jQuery's window resize event.
    // The callback is debounced at 300ms. This means that the callback
    // will be called only one time for any sequence of resize events where
    // each happens within 300ms of the previous event.
    function onWindowResize (callback) {
        var timeout;

        var debouncedCallback = function () {
            if (timeout) {
                clearTimeout(timeout);
            }

            timeout = setTimeout(callback, 300);
        };

        $(window).on('resize', debouncedCallback);
        windowResizeCallbacks.push(debouncedCallback);

        return debouncedCallback;
    }

    var ICON_MAP = {};

    // createIconMap
    // Given an SVG as a string, parse it and extract the content of all
    // symbol elements with an id.
    function createIconMap(iconText) {
        var parser = new DOMParser();
        var iconDoc = parser.parseFromString(iconText, 'image/svg+xml');
        var icons = iconDoc.getElementsByTagName('symbol');

        function attributeReducer(memo, attr) {
            return memo + ' ' + attr.name + '="' + attr.value + '"';
        }

        function childReducer(memo, node) {
            if (node.nodeType !== 1) {
                return memo;
            }

            // Build the DOM string of this node. Unfortunately, IE does
            // not implement innerHTML, outerHTML, or any of the other
            // content methods for SVG Elements and Node elements from
            // the DOMParser.
            return memo + '<' + node.tagName + ' ' +
                _.reduce(node.attributes, attributeReducer, '') +
                '>' +
                (node.childNodes.length ? reduceNode(node) : '') +
                '</' + node.tagName + '>';
        }

        function reduceNode(node) {
            return _.reduce(node.childNodes, childReducer, '');
        }

        _.forEach(icons, function (icon) {
            var id = icon.getAttribute('id');

            if (!id) {
                return;
            }

            ICON_MAP[id] = reduceNode(icon);
        });
    }

    // updateIcon
    // Given a jQuery element with a "pcc-icon-*" class, replace it's contents with
    // an inline SVG icon.
    function updateIcon($elem) {
        var icons = $elem.attr('class').split(/\s+/).filter(function(className) {
            return className.indexOf('pcc-icon-') === 0;
        });

        if (icons.length > 0) {
            if ($elem.find('svg').length === 0) {
                $elem.append('<svg style="pointer-events:none;" viewBox="0 0 52 52">' + ICON_MAP[icons[0]] + '</svg>');
            }
        }
    }

    // parseIcons
    // Given a jQuery element, dive deep down and replace all icon elements with
    // an inline SVG icon. This is not the most performant chunk of code, so use
    // with caution.
    function parseIcons($elem) {
        var $iconParents = $elem.find('.pcc-icon');

        $iconParents.each(function(i, elem) {
            updateIcon($(elem));
        });
    }

    // The main constructor for the Viewer. The preferred method is to use this through the jQuery plugin.
    // $("#mydiv").pccViewer(options);
    function Viewer(element, options) {

        // Check to see if the jQuery Hotkeys plugin is loaded, which is required for keyboard shortcuts to work
        if (!$.hotkeys) {
            throw new Error('Unable to find jquery.hotkeys.min.js, a required dependency.');
        }

        // Check to see if there is one element per instance and present useful errors
        if (!element.length) {
            throw new Error('Unable to find the ' + element.selector + ' element.');
        }

        if (element.length > 1) {
            throw new Error('There are ' + element.length + ' ' + element.selector + ' elements. Please specify only one element per viewer instance.');
        }

        // If we are given a valid options argument, then we will create a new viewer.
        if (typeof options === 'object' && options !== null) {
            // Before we create a new viewer, destroy any existing viewer in the element.
            var existingViewer = element.data(DATAKEY);
            if (existingViewer && existingViewer.destroy) {
                existingViewer.destroy();
            }
        }
        // If options argument has an invalid value, throw.
        else {
            $.error('The options argument has an invalid value.');
        }

        this.redactionReasons = (options.redactionReasons && options.redactionReasons.reasons && options.redactionReasons.reasons.length) ?
                options.redactionReasons:
        {};

        this.redactionReasonsExtended = $.extend(true, {}, this.redactionReasons);

        if (typeof this.redactionReasons.reasons !== 'undefined' && this.redactionReasons.reasons.length) {

            this.redactionReasonsExtended.reasons.forEach(function (reason) {
                reason.selectable = true;
            });
            if (this.redactionReasons.enableFreeformRedactionReasons === true) {
                this.redactionReasonsExtended.reasons.unshift({"reason": PCCViewer.Language.data.redactionReasonFreeform, "class": "pcc-custom-redaction-reasons"});
            }

            this.redactionReasonsExtended.reasons.unshift({"reason": PCCViewer.Language.data.redactionReasonClear, "class": "pcc-clear-redaction-reasons"});
        }

        this.annotationsModeEnum = {
            // All annotations will be displayed as has been done in all releases prior to PCC 10.3
            // In the future, this option will be deprecated. For the 10.3, this option will be the default option.
            LegacyAnnotations: "LegacyAnnotations",

            // The annotations are displayed in the layered annotations mode.
            LayeredAnnotations: "LayeredAnnotations"
        };

        if (options.annotationsMode === undefined) {
            //set the default
            options.annotationsMode = this.annotationsModeEnum.LegacyAnnotations;
        }

        if (this.redactionReasons.enableMultipleRedactionReasons && options.annotationsMode === this.annotationsModeEnum.LegacyAnnotations) {
            throw new Error("When enableMultipleRedactionReasons is true, annotationsMode must be set to \"LayeredAnnotations\"");
        }

        this.attachmentViewingModeEnum = {
            // The attachment will be opened in the new browser window or tab.
            NewWindow: "NewWindow",

            // The attachment will be opened in this viewer instance.
            ThisViewer: "ThisViewer"
        };

        if (options.attachmentViewingMode === undefined) {
            // set the default
            options.attachmentViewingMode = this.attachmentViewingModeEnum.NewWindow;
        }

        var downloadFormats = [
            PCCViewer.Language.data.fileDownloadOriginalDocument,
            PCCViewer.Language.data.fileDownloadPdfFormat
        ];

        var annotationDownloads = [
            PCCViewer.Language.data.fileDownloadAnnotationsNone,
            PCCViewer.Language.data.fileDownloadAnnotationsAll,
            PCCViewer.Language.data.fileDownloadAnnotationsSelected,
        ];

        var redactionDownloads = [
            PCCViewer.Language.data.fileDownloadRedactionsNone,
            PCCViewer.Language.data.fileDownloadRedactionsNormal,
            PCCViewer.Language.data.fileDownloadRedactionsDraft
        ];

        var esignatureDownloads = [
            PCCViewer.Language.data.fileDownloadESignaturesNone,
            PCCViewer.Language.data.fileDownloadESignaturesAll
        ];

        var viewer = this;
        this.$dom = $(element);
        this.viewerID = viewer.$dom.attr("id");
        this.$events = $({});

        // Load template with localization vars, then show the viewer once vars are in place, prevents fouc
        this.$dom
        .html(_.template(options.template.viewer)(_.extend({
            reasons: this.redactionReasonsExtended,
            annotationsMode: options.annotationsMode,
            downloadFormats: downloadFormats,
            annotationDownloads: annotationDownloads,
            redactionDownloads: redactionDownloads,
            esignatureDownloads: esignatureDownloads,
            enableMultipleRedactionReasons: options.enableMultipleRedactionReasons
        },PCCViewer.Language.data)))
            .addClass('pccv')
            .show();

        createIconMap(options.icons);

        // Inject icons into the main template
        parseIcons(this.$dom);

        // Save a reference to these values to be used throughout the module
        this.pageCount = 0;
        this.pageNumber = 0;
        this.presetSearch = options.predefinedSearch || {};
        this.printRequest = {};
        this.currentMarks = [];
        this.uiMouseToolName = "";
        this.tabBreakPoint = 767; // in px, the max-width media query breakpoint for collapsing tabs into menu
        this.esignContext = {};
        this.currentFitType = PCCViewer.FitType.FullWidth;
        this.isFitTypeActive = true;
        this.documentHasText = false;
        this.viewerReady = false;

        // full page redaction dialog
        this.isPageRedactionCanceled = false;
        this.fullPageRedactionReason = (options.redactionReasons && options.redactionReasons.enableMultipleRedactionReasons) ? [] : '';
        this.autoApplyRedactionReason = null;

        // This enum is a whitelist for sticky mouse tools. Tools on this list, with a value
        // of `true`, will be able to be "locked" so that the tool does not automatically switch
        // away when used. This list is extended using one of the config options. Setting this object
        // to an empty object turns off sticky tools completely.
        this.stickyTools = _.extend({
            Magnifier: false,
            SelectToZoom: false,
            PanAndEdit: false,
            SelectText: true,
            LineAnnotation: true,
            RectangleAnnotation: true,
            EllipseAnnotation: true,
            TextAnnotation: true,
            StampAnnotation: true,
            HighlightAnnotation: true,
            FreehandAnnotation: true,
            RectangleRedaction: true,
            TransparentRectangleRedaction: true,
            TextRedaction: true,
            StampRedaction: true,
            TextSelectionRedaction: true,
            PlaceSignature: true,
            ImageStampAnnotation: true,
            ImageStampRedaction: true,
            PolylineAnnotation : true,
            TextHyperlinkAnnotation: true,
            StrikethroughAnnotation: true
        }, options.stickyToolsFilter);
        this.stickyToolsAlwaysOn = false;

        // Check requested behavior for sticky tools. Values can be:
        // 'on' - tools are always sticky
        // 'off' - tools are never sticky
        // 'default' - tools are non-sticky on the first click, but can be toggled to sticky when clicking on an already active tool
        if (options.stickyTools === 'on') {
            this.stickyToolsAlwaysOn = true;
        } else if (options.stickyTools === 'off') {
            // disable all sticky tools
            this.stickyTools = {};
        }

        // This enum is a whitelist for immediate action menu actions. Actions on this list, with a value
        // of `true`, will be able to be selected in the immediate action menu assuming the mark allows it.
        // This list is extended using one of the config options.
        this.immediateActionMenuActions = _.extend({
            comment: true,
            select: false,
            copy: true,
            highlight: true,
            redact: true,
            hyperlink: true,
            strikethrough: true,
            cancel: false,
            'delete': true
        }, options.immediateActionMenuActionsFilter);

        // Standardize template names
        options.template.printOverlay = options.template.printOverlay || options.template.printoverlay;
        options.template.pageRedactionOverlay = options.template.pageRedactionOverlay || options.template.element;
        options.template.contextMenu = options.template.contextMenu || options.template.contextmenu;

        // Validate some of the options used in ViewerControl
        options.resourcePath = options.resourcePath || "img";
        options.imageHandlerUrl = options.imageHandlerUrl || "../pcc.ashx";

        // Save the options to the viewer object
        this.viewerControlOptions = options;

        // Pass enableMultipleRedactionReasons option to the ViewerControll
        this.viewerControlOptions.enableMultipleRedactionReasons = !!(options.redactionReasons && options.redactionReasons.enableMultipleRedactionReasons);

        this.viewerControl = {};
        // DOM Nodes
        this.viewerNodes = {
            $download: viewer.$dom.find("[data-pcc-download]"),
            $pageList: viewer.$dom.find("[data-pcc-pageList]"),
            $nav: viewer.$dom.find("[data-pcc-nav]"),
            $navTabs: viewer.$dom.find("[data-pcc-nav-tab]"),
            $tabItems: viewer.$dom.find(".pcc-tab-item"),
            $toggles: viewer.$dom.find('[data-pcc-toggle]'),
            $dropdowns: viewer.$dom.find('[data-pcc-toggle-id*="dropdown"]'),
            $defaults: viewer.$dom.find('[data-pcc-default]'),
            $pageCount: viewer.$dom.find("[data-pcc-pagecount]"),
            $pageSelect: viewer.$dom.find("[data-pcc-pageSelect]"),
            $contextMenu: viewer.$dom.find('[data-pcc-context-menu]'),
            $firstPage: viewer.$dom.find("[data-pcc-first-page]"),
            $prevPage: viewer.$dom.find("[data-pcc-prev-page]"),
            $nextPage: viewer.$dom.find("[data-pcc-next-page]"),
            $lastPage: viewer.$dom.find("[data-pcc-last-page]"),
            $mouseTools: viewer.$dom.find("[data-pcc-mouse-tool]"),
            $selectText: viewer.$dom.find('[data-pcc-mouse-tool*="AccusoftSelectText"]'),
            $panTool: viewer.$dom.find('[data-pcc-mouse-tool*="AccusoftPanAndEdit"]'),
            $fitContent: viewer.$dom.find("[data-pcc-fit-content]"),
            $rotatePage: viewer.$dom.find("[data-pcc-rotate-page]"),
            $rotateDocument: viewer.$dom.find("[data-pcc-rotate-document]"),
            $imageTools: viewer.$dom.find("[data-pcc-image-tools]"),
            $attachments: viewer.$dom.find('[data-pcc-attachments]'),
            $zoomIn: viewer.$dom.find("[data-pcc-zoom-in]"),
            $zoomOut: viewer.$dom.find("[data-pcc-zoom-out]"),
            $zoomLevel: viewer.$dom.find("[data-pcc-zoom-level]"),
            $scaleDropdown: viewer.$dom.find(".pcc-scale-dropdown"),
            $fullScreen: viewer.$dom.find('[data-pcc-fullscreen]'),
            $dialogs: viewer.$dom.find('.pcc-dialog'),
            $annotationList: viewer.$dom.find("[data-pcc-load-annotations=list]"),
            $endPreview: viewer.$dom.find("[data-pcc-end-preview]"),
            $highlightAnnotation: viewer.$dom.find('[data-pcc-mouse-tool*="AccusoftHighlightAnnotation"]'),
            $strikethroughAnnotation: viewer.$dom.find('[data-pcc-mouse-tool*="AccusoftStrikethroughAnnotation"]'),
            $hyperlinkAnnotation: viewer.$dom.find('[data-pcc-mouse-tool*="AccusoftTextHyperlinkAnnotation"]'),
            $textSelectionRedaction: viewer.$dom.find('[data-pcc-mouse-tool*="AccusoftTextSelectionRedaction"]'),

            $downloadDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-download]"),
            $downloadAsDropdown: viewer.$dom.find('[data-pcc-toggle="dropdown-download"]'),

            $downloadAnnotationsAsDropdown: viewer.$dom.find('[data-pcc-toggle="dropdown-download-annotations"]'),
            $downloadRedactionsAsDropdown: viewer.$dom.find('[data-pcc-toggle="dropdown-download-redactions"]'),
            $downloadESignaturesAsDropdown: viewer.$dom.find('[data-pcc-toggle="dropdown-download-esignatures"]'),

            $downloadDocumentPreview: viewer.$dom.find('[data-pcc-download="preview"]'),
            $downloadDocument: viewer.$dom.find('[data-pcc-download="download"]'),

            $annotationLayersLoadDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-load-annotation-layers]"),
            $annotationLayersList: viewer.$dom.find("[data-pcc-load-annotation-layers=list]"),
            $annotationLayersBack: viewer.$dom.find("[data-pcc-load-annotation-layers=back]"),
            $annotationLayersDone: viewer.$dom.find("[data-pcc-load-annotation-layers=done]"),
            $annotationLayersDropdown: viewer.$dom.find("[data-pcc-load-annotation-layers=dropdownlist]"),
            $annotateSaveDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-save-annotations]"),
            $annotateLoadDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-load-annotations]"),
            $annotateLoadDropdown: viewer.$dom.find("[data-pcc-toggle-id=dropdown-load-annotations]"),

            $annotationLayerReviewOther: viewer.$dom.find("[data-pcc-annotation-layer-review-section=other]"),
            $annotationLayerMergeActions: viewer.$dom.find("[data-pcc-annotation-layer-review-merge-actions]"),
            $annotationLayerMerge: viewer.$dom.find("[data-pcc-annotation-layer-review=merge]"),
            $annotationLayerMergeAll: viewer.$dom.find("[data-pcc-annotation-layer-review=mergeAll]"),
            $annotationLayerMergeMode: viewer.$dom.find("[data-pcc-annotation-layer-review=mergeMode]"),
            $annotationLayerMergeCancel: viewer.$dom.find("[data-pcc-annotation-layer-review=mergeCancel]"),
            $annotationLayerShowAll: viewer.$dom.find("[data-pcc-annotation-layer-review=showAll]"),
            $annotationLayerHideAll: viewer.$dom.find("[data-pcc-annotation-layer-review=hideAll]"),

            $annotationLayerSaveDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-annotation-layer-save]"),
            $annotationLayerSave: viewer.$dom.find("[data-pcc-save-layer]"),

            $overlay: viewer.$dom.find('[data-pcc-overlay]'),
            $overlayFade: viewer.$dom.find('.pcc-overlay-fade'),
            $esignManage: viewer.$dom.find("[data-pcc-esign=manage]"),
            $esignFreehandLaunch: viewer.$dom.find("[data-pcc-esign=freehandLaunch]"),
            $esignTextLaunch: viewer.$dom.find("[data-pcc-esign=textLaunch]"),
            $esignImageLaunch: viewer.$dom.find("[data-pcc-esign=imageLaunch]"),
            $esignOverlay: viewer.$dom.find("[data-pcc-esign=overlay]"),
            $esignPlace: viewer.$dom.find("[data-pcc-esign=place]"),
            $esignPlaceDate: viewer.$dom.find("[data-pcc-esign=placeDate]"),
            $printLaunch: viewer.$dom.find("[data-pcc-print=launch]"),
            $printOverlay: viewer.$dom.find("[data-pcc-print=overlay]"),
            $pageRedactionLaunch: viewer.$dom.find("[data-pcc-page-redaction=launch]"),
            $pageRedactionOverlay: viewer.$dom.find("[data-pcc-page-redaction=overlay]"),
            $redactionViewMode: viewer.$dom.find("[data-pcc-redactionViewmode]"),

            $revisionLoader: viewer.$dom.find("[data-pcc-revision=loader]"),
            $revisionStatus: viewer.$dom.find("[data-pcc-revision=status]"),
            $revisions: viewer.$dom.find("[data-pcc-revision=results]"),
            $revisionCount: viewer.$dom.find("[data-pcc-revision=revisionCount]"),
            $revisionsContainer: viewer.$dom.find('[data-pcc-revision-container=results]'),


            $revisionPrevItem: viewer.$dom.find("[data-pcc-revision=prevResult]"),
            $revisionNextItem: viewer.$dom.find("[data-pcc-revision=nextResult]"),

            $revisionPrevPage: viewer.$dom.find("[data-pcc-revision=prevPage]"),
            $revisionNextPage: viewer.$dom.find("[data-pcc-revision=nextPage]"),
            $revisionToggle: viewer.$dom.find("[data-pcc-toggle=dialog-revision]"),
            $revisionDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-revision]"),

            $searchDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-search]"),
            $searchInput: viewer.$dom.find("[data-pcc-search=input]"),
            $searchSubmit: viewer.$dom.find("[data-pcc-search=submit]"),
            $searchRedact: viewer.$dom.find("[data-pcc-search-quick-action=redact]"),
            $searchCancel: viewer.$dom.find("[data-pcc-search=cancel]"),
            $searchCloser: viewer.$dom.find("[data-pcc-search=closer]"),
            $searchClear: viewer.$dom.find("[data-pcc-search=clear]"),

            $searchFilterContainer: viewer.$dom.find('[data-pcc-search-container=filter]'),

            $searchQuickActionsToggle: viewer.$dom.find('[data-pcc-search-container-toggle=quick-actions]'),
            $searchQuickActionsContainer: viewer.$dom.find('[data-pcc-search-container=quick-actions]'),
            $searchQuickActionsSearchTerms: viewer.$dom.find('[data-pcc-section=quickActionSearchTerms]'),
            $searchQuickActionRedact: viewer.$dom.find('[data-pcc-search-quick-action=redact]'),
            $searchQuickActions: viewer.$dom.find('[data-pcc-section=searchQuickActions]'),
            $searchQuickActionRedactOptions: viewer.$dom.find('[data-pcc-section=searchQuickActionRedactOptions]'),
            $searchQuickActionRedactDone: viewer.$dom.find('[data-pcc-search-quick-action=redactReasonUpdateDone]'),
            $searchQuickActionRedactionDropdownContainer: viewer.$dom.find('[data-pcc-qa-toggle="dropdown-quick-action-redaction-reason"]'),
            $searchQuickActionRedactionDropdown: viewer.$dom.find('[data-pcc-qa-toggle-id=dropdown-quick-action-redaction-reason]'),
            $searchQuickActionRedactionInput: viewer.$dom.find('[data-pcc-qa-redaction-reason-input]'),
            $searchQuickActionRedactionDropdownLabel: viewer.$dom.find('[data-pcc-redaction-reason-dropdown-label]'),

            $searchResultsContainer: viewer.$dom.find('[data-pcc-search-container=results]'),

            $searchPreviousContainer: viewer.$dom.find('[data-pcc-previous-search]'),
            $searchPresets: viewer.$dom.find('[data-pcc-toggle-id=dropdown-search-patterns] label'),
            $searchPresetsContainer: viewer.$dom.find('[data-pcc-predefined-search]'),
            $searchFixedPresetsContainer: viewer.$dom.find('[data-pcc-predefined-fixed-search]'),
            $searchToggleAllPresets: viewer.$dom.find("[data-pcc-search=toggleAllPresets]"),

            $searchLoader: viewer.$dom.find("[data-pcc-search=loader]"),
            $searchStatus: viewer.$dom.find("[data-pcc-search=status]"),
            $searchResults: viewer.$dom.find("[data-pcc-search=results]"),
            $searchResultCount: viewer.$dom.find("[data-pcc-search=resultCount]"),

            $searchPrevResult: viewer.$dom.find("[data-pcc-search=prevResult]"),
            $searchNextResult: viewer.$dom.find("[data-pcc-search=nextResult]"),

            $searchPrevResultsPage: viewer.$dom.find("[data-pcc-search=prevResultsPage]"),
            $searchNextResultsPage: viewer.$dom.find("[data-pcc-search=nextResultsPage]"),

            $searchExactPhrase: viewer.$dom.find("[data-pcc-search=exactWord]"),
            $searchMatchCase: viewer.$dom.find("[data-pcc-search=matchCase]"),
            $searchMatchWholeWord: viewer.$dom.find("[data-pcc-search=matchWholeWord]"),
            $searchBeginsWith: viewer.$dom.find("[data-pcc-search=beginsWith]"),
            $searchEndsWith: viewer.$dom.find("[data-pcc-search=endsWith]"),
            $searchWildcard: viewer.$dom.find("[data-pcc-search=wildcard]"),
            $searchProximity: viewer.$dom.find("[data-pcc-search=proximity]"),

            $imageStampOverlay: viewer.$dom.find("[data-pcc-image-stamp=overlay]"),
            $imageStampSelect: viewer.$dom.find("[data-pcc-image-stamp=select]"),
            $imageStampRedactSelect: viewer.$dom.find("[data-pcc-image-stamp-redact=select]"),

            $commentsPanel: viewer.$dom.find("[data-pcc-comments-panel]"),

            $thumbnailDialog: viewer.$dom.find("[data-pcc-toggle-id=dialog-thumbnails]"),
            $thumbnailList: viewer.$dom.find("[data-pcc-thumbs]"),

            $breakpointTrigger: viewer.$dom.find("[data-pcc-breakpoint-trigger]")
        };

        // Breakpoint detection in JS, to ensure that we can provide necessary behavior when appropriate.
        this.breakpointEnum = {
            mobile: 'mobile',
            desktop: 'desktop',
            initial: 'initial'
        };
        this.getBreakpoint = function() {
            var breakpoint = this.breakpointEnum.initial;

            // Chances are good that browsers with no getComputedStyle also don't support media queries.
            if (window.getComputedStyle) {
                var tag = window.getComputedStyle(viewer.viewerNodes.$breakpointTrigger.get(0),':after').getPropertyValue('content') || '';
                tag = tag.replace(/["']/g,''); // remove quotes in browsers that return them
                breakpoint = this.breakpointEnum[tag] || breakpoint;
            }

            this.latestBreakpoint = breakpoint;
            return breakpoint;
        };
        this.latestBreakpoint = this.getBreakpoint();
        onWindowResize(function() {
            // Update the breakpoint when the window resizes.
            // This will be throttled a bit to same some costs on rapid events.
            viewer.getBreakpoint();

            // Update context menu dropdowns max-height property
            updateContextMenuDropdownsMaxHeight();

            // Update full page redaction dropdown max-height property
            updateFullPageRedactionDropdownsMaxHeight();
        });

        //for keyboard keys
        this.$pageListContainerWrapper = this.viewerNodes.$pageList.find('.pccPageListContainerWrapper');
        this.activeElement = document.activeElement;
        this.prevActiveElement = document.activeElement;

        // Call the various methods required for initialization
        this.initializeViewer = function () {

            var maxPageWidth = 0;
            this.createPageList();
            this.bindMarkup();

            var me = this;
            var initOnPageCountReady = function () {
                viewer.viewerControl.off('PageCountReady', initOnPageCountReady);

                me.imageToolsDropdownUI.init();
                me.annotationIo.init();
                me.annotationLayerReview.init();
                me.annotationLayerSave.init(me.viewerControl, PCCViewer.Language.data, me.viewerNodes.$annotationLayerSaveDialog, me.notify);
                me.eSignature.init();
                me.imageStamp.init({
                    $imageStampSelect: viewer.viewerNodes.$imageStampSelect,
                    $imageStampRedactSelect: viewer.viewerNodes.$imageStampRedactSelect,
                    $imageStampOverlay: viewer.viewerNodes.$imageStampOverlay
                });

                var opts = viewer.viewerControlOptions;
                if (opts.annotationsMode === viewer.annotationsModeEnum.LayeredAnnotations) {
                    if (opts.autoLoadAllLayers) {
                        // check if layered annotations are turned on, and we should
                        // load all of the layers by default
                        me.annotationIo.autoLoadAllLayers(function(err){
                            // open the comments panel if there are comments present
                            commentUIManager.openIfVisibleMarks();
                        });
                    }
                    else {
                        // Check if a layer needs to be loaded for edit
                        var loadEditableLayerFromXml = typeof viewer.viewerControlOptions.editableMarkupLayerSource === 'string' && viewer.viewerControlOptions.editableMarkupLayerSource.toLowerCase() === 'xmlname';
                        var loadEditableLayer = typeof viewer.viewerControlOptions.editableMarkupLayerSource === 'string' && viewer.viewerControlOptions.editableMarkupLayerSource.toLowerCase() === 'layerrecordid' && viewer.viewerControlOptions.editableMarkupLayerValue !== undefined;

                        if (loadEditableLayerFromXml === true) {
                            // Get the markup layers to check if the original XML name matches any saved layers, if so load from the JSON layer
                            me.annotationIo.autoLoadEditableXml(viewer.viewerControlOptions.editableMarkupLayerValue);
                        }
                        else if (loadEditableLayer === true) {
                            me.annotationIo.autoLoadEditableLayer(viewer.viewerControlOptions.editableMarkupLayerValue);
                        }

                    }
                }

                if (typeof opts.editableMarkupLayerSource === 'string' && opts.editableMarkupLayerSource.toLowerCase() === 'defaultname' && opts.editableMarkupLayerValue !== undefined) {
                    // Set the editable layer name
                    viewer.viewerControl.getActiveMarkupLayer().setName(opts.editableMarkupLayerValue);
                }

                if (viewer.redactionReasons.autoApplyDefaultReason === true) {
                    var defaultReasons = [];

                    _.each(viewer.redactionReasons.reasons, function (reasonObj) {

                        if (typeof reasonObj.defaultReason !== 'undefined' && reasonObj.defaultReason === true) {
                            defaultReasons.push(reasonObj.reason);
                        }

                    });

                    if (!options.enableMultipleRedactionReasons && defaultReasons.length > 1) {
                        viewer.notify({message: PCCViewer.Language.data.redactionErrorDefault});
                    }

                    if (defaultReasons.length) {
                        if (options.enableMultipleRedactionReasons) {
                            PCCViewer.MouseTools.getMouseTool('AccusoftRectangleRedaction').getTemplateMark().setReasons(defaultReasons);
                            PCCViewer.MouseTools.getMouseTool('AccusoftTextSelectionRedaction').getTemplateMark().setReasons(defaultReasons);
                            viewer.autoApplyRedactionReason = defaultReasons;
                        } else {
                            PCCViewer.MouseTools.getMouseTool('AccusoftRectangleRedaction').getTemplateMark().setReason(defaultReasons[0]);
                            PCCViewer.MouseTools.getMouseTool('AccusoftTextSelectionRedaction').getTemplateMark().setReason(defaultReasons[0]);
                            viewer.autoApplyRedactionReason = defaultReasons[0];
                        }
                    }
                }

                if (typeof viewer.redactionReasons.reasons !== 'undefined' && viewer.redactionReasons.reasons.length) {

                    if (viewer.redactionReasons.enableRedactionReasonSelection !== false) {
                        viewer.redactionReasons.enableRedactionReasonSelection = true;
                    }

                    if (viewer.redactionReasons.enableRedactionReasonSelection === false) {
                        viewer.redactionReasons.reasons = [];
                    }
                }
            };

            viewer.viewerControl.on('PageCountReady', initOnPageCountReady);

            viewer.viewerControl.on('PageDisplayed', function (ev) {
                viewer.viewerControl.requestPageAttributes(ev.pageNumber).then(
                    function (pageAttributes) {
                        if (maxPageWidth === 0) {
                            // The first page has displayed. Set the initial maxPageWidth.
                            maxPageWidth = pageAttributes.width;
                        }
                        else if (pageAttributes.width > maxPageWidth) {
                            maxPageWidth = pageAttributes.width;
                            if (viewer.isFitTypeActive === true) {
                                viewer.viewerControl.fitContent(viewer.currentFitType);
                            }
                        }
                    }
                );
            });

            setUIElements();
            setMouseToolDefaults();
            placeholderPolyfill();
            disableContextMenuTabbing();

            PCCViewer.MouseTools.createMouseTool("AccusoftPlaceDateSignature", PCCViewer.MouseTool.Type.PlaceSignature);

            if (typeof options.pageLayout === 'string' && options.pageLayout.toLowerCase() === "horizontal") {
                viewer.currentFitType = PCCViewer.FitType.FullHeight;
            }

            if (typeof options.viewMode === 'string' && options.viewMode.toLowerCase() === "singlepage") {
                viewer.currentFitType = PCCViewer.FitType.FullPage;
            }

            // On window resize adjust dialogs and fit document
            onWindowResize(function () {
                toggleDialogOffset();
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });
            viewer.$pageListContainerWrapper = viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper');
            //bind the keyboard keys
            this.initKeyBindings();
        };

        // Bind the public API to the nodes
        this.bindMarkup = function () {

            var documentScrollPosition;

            // Page Navigation buttons
            viewer.viewerNodes.$firstPage.on('click', function () {
                viewer.viewerControl.changeToFirstPage();
            });
            viewer.viewerNodes.$prevPage.on('click', function () {
                viewer.viewerControl.changeToPrevPage();
            });
            viewer.viewerNodes.$nextPage.on('click', function () {
                viewer.viewerControl.changeToNextPage();
            });
            viewer.viewerNodes.$lastPage.on('click', function () {
                viewer.viewerControl.changeToLastPage();
            });

            // Fit Document to Width button
            viewer.viewerNodes.$fitContent.on('click', function () {

                if (viewer.isFitTypeActive === false) {
                    viewer.isFitTypeActive = true;
                    viewer.viewerNodes.$fitContent.addClass('pcc-active');
                    if (viewer.uiMouseToolName === 'AccusoftSelectToZoom') {
                        viewer.setMouseTool({ mouseToolName: 'AccusoftPanAndEdit' });
                    }
                    viewer.viewerControl.fitContent(viewer.currentFitType);
                } else {
                    viewer.isFitTypeActive = false;
                    viewer.viewerNodes.$fitContent.removeClass('pcc-active');
                }

            });

            // Rotate Page button
            viewer.viewerNodes.$rotatePage.on('click', function () {
                viewer.viewerControl.rotatePage(90);
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });

            // Rotate Document button
            viewer.viewerNodes.$rotateDocument.on('click', function () {
                viewer.viewerControl.rotateDocument(90);
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });

            // Zoom buttons
            viewer.viewerNodes.$zoomIn.on('click', function () {
                if (!this.className.match('pcc-disabled')) {
                    viewer.viewerControl.zoomIn(1.25);
                }
            });
            viewer.viewerNodes.$zoomOut.on('click', function () {
                if (!this.className.match('pcc-disabled')) {
                    viewer.viewerControl.zoomOut(1.25);
                }
            });

            function dismissFitMenuHandler () {
                viewer.viewerNodes.$scaleDropdown.removeClass('pcc-show');
                $(document.body).off('click', dismissFitMenuHandler);
            }

            viewer.viewerNodes.$zoomLevel.on('click', function () {
                if (viewer.viewerNodes.$scaleDropdown.hasClass('pcc-show') === false) {
                    viewer.viewerNodes.$scaleDropdown.addClass('pcc-show');
                    setTimeout(function() {
                        $(document.body).on('click', dismissFitMenuHandler);
                    }, 0);
                }
            });
            viewer.viewerNodes.$scaleDropdown.on('click', function (ev) {
                var $target = $(ev.target);
                var data = $target.data();

                if (data.pccFit) {
                    viewer.currentFitType = data.pccFit;
                    viewer.viewerControl.fitContent(data.pccFit);
                } else if (data.pccScale) {
                    viewer.viewerControl.setScaleFactor(data.pccScale / 100);
                    viewer.viewerNodes.$zoomLevel.html(data.pccScale + '%');
                }

                viewer.viewerNodes.$scaleDropdown.removeClass('pcc-show');
                $(document.body).off('click', dismissFitMenuHandler);
            });

            // Full-screen toggle button
            viewer.viewerNodes.$fullScreen.on('click', function (ev) {
                viewer.$dom.toggleClass('pcc-full-screen');
                viewer.viewerNodes.$fullScreen.toggleClass('pcc-active');
                updateContextMenuDropdownsMaxHeight();
                updateFullPageRedactionDropdownsMaxHeight();
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });

            // Comments Panel toggle button
            viewer.viewerNodes.$commentsPanel.on('click', function () {

                var $pageListWrapper = viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper');

                if (viewer.viewerControl.getIsCommentsPanelOpen() === true) {
                    viewer.viewerNodes.$commentsPanel.removeClass('pcc-active');
                    viewer.viewerControl.closeCommentsPanel();
                    if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }

                    if (typeof documentScrollPosition !== 'undefined') {
                        viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper').scrollLeft(documentScrollPosition);
                    }
                }
                else {
                    documentScrollPosition = $pageListWrapper.scrollLeft();
                    viewer.viewerNodes.$commentsPanel.addClass('pcc-active');
                    viewer.viewerControl.openCommentsPanel();
                    if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
                    $pageListWrapper.scrollLeft(viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper > div:first-child').width());
                }
            });

            // End Preview button
            viewer.viewerNodes.$endPreview.on('click', function () {
                fileDownloadManager.endPreview();
            });

            viewer.viewerNodes.$esignPlace.on('click', function (ev) {
                // get last known signature
                var accusoftPlaceSignature = PCCViewer.MouseTools.getMouseTool('AccusoftPlaceSignature');
                var prevSignature = accusoftPlaceSignature.getTemplateMark().getSignature() || undefined;

                // Assign the signature to the mouse tool
                // This function will use the first signature as the default if one is not provided
                // We will update this every time in case some attributes have changed
                viewer.eSignature.changeMouseToolSignature(prevSignature, false, false);
            });

            viewer.viewerNodes.$esignPlaceDate.on('click', function (ev) {
                // get last known signature
                var accusoftPlaceSignature = PCCViewer.MouseTools.getMouseTool('AccusoftPlaceDateSignature');

                var date = new Date();
                var dateFormat = options.signatureDateFormat || 'MM/DD/YYYY';
                accusoftPlaceSignature.getTemplateMark().setSignature({ text: formatDate(date, dateFormat.toString()), fontName: "Arial" });

                viewer.setMouseTool({
                    mouseToolName: 'AccusoftPlaceDateSignature',
                    thisButton: this
                });
            });

            viewer.viewerNodes.$esignFreehandLaunch.on('click', viewer.launchESignFreehand);
            viewer.viewerNodes.$esignTextLaunch.on('click', viewer.launchESignText);
            viewer.viewerNodes.$esignManage.on('click', viewer.launchESignManage);


            // E-Signature modal
            viewer.viewerNodes.$esignOverlay
                // Close/Cancel button
                .on('click', '[data-pcc-esign="cancel"]', function () {
                    viewer.closeEsignModal();
                    $(window).off('resize', resizeESignContext);
                })

                // Toggle nodes
                .on('click', '[data-pcc-toggle]', function (ev) {
                    toggleNodes(ev, viewer.viewerNodes.$esignOverlay);
                })

                // Clear signature
                .on('click', '[data-pcc-esign="clear"]', function () {
                    if (viewer.esignContext && viewer.esignContext.clear) {
                        viewer.esignContext.clear();
                    }
                })

                // Download signature
                .on('click', '[data-pcc-esign="download"]', function () {
                    viewer.viewerControl.downloadSignature(PCCViewer.Signatures.toArray()[0]);
                })

                .on('click', '[data-pcc-checkbox]', function (ev) {
                    var $el = $(ev.currentTarget);
                    $el.toggleClass('pcc-checked');
                })

                // Save
                .on('click', '[data-pcc-esign="save"]', function () {
                    var futureUse = viewer.viewerNodes.$esignOverlay.find('[data-pcc-checkbox]').hasClass('pcc-checked'),
                        categry = viewer.viewerNodes.$esignOverlay.find('[data-pcc-esign-category] .pcc-label').html();

                    if (viewer.esignContext && viewer.esignContext.done) {
                        var signature = viewer.esignContext.done();

                        if (signature.path === 'M0,0' || signature.text === "") {
                            // Do not save paths with no content or empty string text signatures.
                            // The user probably pressed "Save" by mistake
                            viewer.closeEsignModal();
                            return;
                        }

                        // Add custom properties
                        signature.category = categry;

                        // Add directive for local save code
                        signature.localSave = !!futureUse;

                        // Close modal
                        viewer.closeEsignModal();

                        // Enable the place signature tool.
                        viewer.viewerNodes.$esignPlace.prop('disabled', false).removeClass('pcc-disabled');

                        // Add to signatures collection if user requested it.
                        PCCViewer.Signatures.add(signature);

                        // Set the newly created signature as the default for the PlaceSignature mouse tool
                        viewer.eSignature.changeMouseToolSignature(signature, true);

                        // Update the context menu
                        updateContextMenu({
                            showContextMenu: true,
                            showAllEditControls: false,
                            mouseToolType: viewer.eSignature.mouseTool.getType()
                        });
                    }

                    $(window).off('resize', resizeESignContext);
                })

                // add convenience button to start new drawing from Manage view
                .on('click', '[data-pcc-esign="drawNew"]', viewer.launchESignFreehand)

                // add convenience button to start new text from Manage view
                .on('click', '[data-pcc-esign="typeNew"]', viewer.launchESignText)

                // Prevent default behavior of buttons inside the e-sign overlay to prevent form submission.
                .on('click', 'button', function (ev) {
                    ev.preventDefault();
                })

                // Configure dropdown in the esign overlay
                .on('click', '[data-pcc-toggle-id*="dropdown"]', function(ev){
                    handleDropdownBehavior(ev);
                });

            viewer.viewerNodes.$imageStampOverlay
                // Toggle nodes
                .on('click', '[data-pcc-toggle]', function (ev) {
                    toggleNodes(ev, viewer.viewerNodes.$imageStampOverlay);
                })
                // Configure dropdown in the esign overlay
                .on('click', '[data-pcc-toggle-id*="dropdown"]', function(ev){
                    handleDropdownBehavior(ev);
                });

            // Launch page redaction modal
            viewer.viewerNodes.$pageRedactionLaunch.on('click', function (ev) {
                // a switch we use to cancel page redaction
                viewer.isPageRedactionCanceled = false;

                if (options.template.pageRedactionOverlay) {
                    // template data that is used to configure how the page redaction overlay is shown
                    var tmplData = _.extend({
                        // indicates that the page redaction overlay will show the form to redact page(s)
                        show: 'form',
                        reasons: viewer.redactionReasonsExtended,
                        enableCustomRedactionReason: false,
                        enableMultipleRedactionReasons: options.enableMultipleRedactionReasons
                    }, PCCViewer.Language.data);

                    // Show the page redaction overlay and backdrop (fade)
                    viewer.viewerNodes.$pageRedactionOverlay.html(_.template(options.template.pageRedactionOverlay)(tmplData)).addClass('pcc-open');
                    viewer.viewerNodes.$overlayFade.show();

                    parseIcons(viewer.viewerNodes.$pageRedactionOverlay);
                    updateFullPageRedactionDropdownsMaxHeight();

                    // If there is an auto apply redaction reason, set the fullPageRedactionReason to that value.
                    if (viewer.autoApplyRedactionReason) {
                        viewer.fullPageRedactionReason = viewer.autoApplyRedactionReason;
                    }

                    viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason-input]')
                        .hide()
                        .on('input', function(ev) {
                            var val = $(this).val();
                            if (viewer.redactionReasons.maxLengthFreeformRedactionReasons && val.length > viewer.redactionReasons.maxLengthFreeformRedactionReasons) {
                                viewer.notify({message: PCCViewer.Language.data.redactionReasonFreeforMaxLengthOver});
                                $(this).val(val.substring(0, viewer.redactionReasons.maxLengthFreeformRedactionReasons));
                            }
                            viewer.fullPageRedactionReason = options.enableMultipleRedactionReasons ? [val] : val;
                        });

                    // Update the redaction reason label with the last used full page redaction reason
                    if (viewer.fullPageRedactionReason && viewer.fullPageRedactionReason.length > 0) {

                        var redactionReasonsText = options.enableMultipleRedactionReasons
                            ? getMultipleRedactionReasonsText(viewer.fullPageRedactionReason)
                            : viewer.fullPageRedactionReason;

                        if (!redactionReasonMenu.isPreloadedRedactionReason(viewer.fullPageRedactionReason)) {
                            // Activate free form redaction
                            viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason-input]').val(redactionReasonsText).show().focus();
                            setPageRedactionDropdownLabel(PCCViewer.Language.data.redactionReasonFreeform);
                        } else {
                            if (options.enableMultipleRedactionReasons) {
                                // Activate selected reasons
                                var $pageRedactionReasons = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-checkbox="redaction-reasons"]');
                                $pageRedactionReasons.each(function () {
                                    var $this = $(this);
                                    if (viewer.fullPageRedactionReason.indexOf($this.find('.pcc-select-multiple-redaction-reason').text()) >= 0) {
                                        $this.addClass('pcc-checked');
                                    } else {
                                        $this.removeClass('pcc-checked');
                                    }
                                });
                            }
                            setPageRedactionDropdownLabel(redactionReasonsText);
                        }
                    }

                    placeholderPolyfill();
                    updatePageRedactionOverlayRangeInputs();
                } else {
                    // Throw an error for integrators in the case that the template is not defined.
                    // It's a common mistake to leave out templates.
                    throw new Error("The pageRedactionOverlay template is not defined in the viewer's options object.");
                }
            });

            // A helper for the page redaction overlay. This method checks the state of the form,
            // validates the include and exclude ranges, and may set classes on range inputs to
            // indicate an error.
            function updatePageRedactionOverlayRangeInputs() {
                var redactAllPagesChecked = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-page-redaction=redactAllPages]').hasClass('pcc-checked'),
                    redactRangeChecked = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-page-redaction=redactRange]').hasClass('pcc-checked'),
                    $excludeRangeFieldEl = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-page-redaction-field=excludeRange]'),
                    $includeRangeEl = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-page-redaction-range=include]'),
                    $excludeRangeEl = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-page-redaction-range=exclude]');


                // Hide the exclude range input if redactAllPages element is unchecked
                if (redactAllPagesChecked) {
                    $excludeRangeFieldEl.show();
                } else {
                    $excludeRangeFieldEl.hide();
                }

                // re-validate page ranges. The error state may change when the checked state changes
                validateRangeAndUpdateErrorClass($includeRangeEl, {ignoreErrors: !redactRangeChecked, allIsValid: true});
                validateRangeAndUpdateErrorClass($excludeRangeEl, {
                    ignoreErrors: !redactAllPagesChecked,
                    emptyIsValid: true,
                    allIsValid: false
                });
            }

            // A helper for the page redaction overlay. This method checks the state of a range input
            // and may set a class on the input to indicate an error with the specified range.
            function validateRangeAndUpdateErrorClass($target, options) {
                options = options || {};

                // ignoreErrors - if there are errors in the range input, don't show the class
                var ignoreErrors = options.ignoreErrors || false,

                    // emptyIsValid - an empty range input is valid
                    emptyIsValid = options.emptyIsValid || false,

                    // allIsValid - all value is valid
                    allIsValid = options.allIsValid || false,

                    // The range value from the input
                    range = getInputValueNotPlaceholder($target).toLowerCase(),

                    // Indicates if the range is empty and the error class should not be applied.
                    ignoreBecauseEmpty = emptyIsValid && range.length === 0,

                    //Validation for 'all' value case
                    ignoreBecauseAll = range === 'all' && allIsValid;

                var isValid = ignoreErrors || ignoreBecauseEmpty || PCCViewer.Util.validatePageRange(range, {
                        upperLimit: viewer.viewerControl.getPageCount()
                }) && !(range === 'all' && allIsValid === false),
                    errorClass = 'pccError';

                // Add or remove the errorClass, which indicates that the range input is invalid but a
                // valid value is required.
                if (isValid) {
                    $target.removeClass(errorClass);
                } else {
                    $target.addClass(errorClass);
                }
            }

            // A helper for the page redaction overlay. This recursive method requests page attributes
            // and updates the progress bar in the page redaction overlay, after the user has clicked the
            // redact button.
            function requestPageAttributesAndUpdateProgressBar(pageNumbers, index, allPageAttributes) {
                var deferred;
                allPageAttributes = allPageAttributes || [];
                index = index || 0;

                if (!viewer.isPageRedactionCanceled && index < pageNumbers.length) {
                    var percent = Math.round(100 * (index / (pageNumbers.length + 1))) + '%';

                    // Show page count.
                    viewer.$dom.find('[data-pcc-page-redaction=resultCount]').html(PCCViewer.Language.data.pageRedactionOverlay.requestingAttributesOf + ' ' + pageNumbers[index]);

                    // Show percentage and update load bar.
                    viewer.$dom.find('[data-pcc-page-redaction=resultPercent]').html(percent);
                    viewer.$dom.find('[data-pcc-page-redaction=loader]').css('width', percent);

                    return viewer.viewerControl.requestPageAttributes(pageNumbers[index]).then(
                        function onFulfilled(pageAttributes) {
                            allPageAttributes.push(pageAttributes);

                            return requestPageAttributesAndUpdateProgressBar(pageNumbers, index + 1, allPageAttributes);
                        }
                    );
                } else {
                    deferred = PCCViewer.Deferred();
                    deferred.resolve(allPageAttributes);
                    return deferred.getPromise();
                }
            }

            // Helper for the page redaction overlay. This method set the label of redaction reasons dropdown
            function setPageRedactionDropdownLabel(text) {
                viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason]').find('.pcc-label').text(text);
            }

            // Redact page redaction modal
            viewer.viewerNodes.$pageRedactionOverlay
                // Cancel button
                .on('click', '[data-pcc-page-redaction="cancel"]', function () {
                    viewer.viewerNodes.$pageRedactionOverlay.removeClass('pcc-open');
                    viewer.viewerNodes.$overlayFade.hide();
                    viewer.isPageRedactionCanceled = true;
                })

                // Radio buttons
                .on('click', '[data-pcc-radio]', function (ev) {
                    var $el = $(ev.currentTarget);

                    $el.addClass('pcc-checked');
                    viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-radio="' + $el.data('pccRadio') + '"]').not(this).removeClass('pcc-checked');

                    updatePageRedactionOverlayRangeInputs();
                    updateFullPageRedactionDropdownsMaxHeight();
                })

                // Validate include range if required
                .on('click', '[data-pcc-page-redaction=redactRange]', function (ev) {
                    var $el = $(ev.currentTarget);

                    $el.addClass('pcc-checked');
                    viewer.$dom.find('[data-pcc-radio="' + $el.data('pccRadio') + '"]').not(this).removeClass('pcc-checked');

                    updatePageRedactionOverlayRangeInputs();
                })

                // Page range
                .on('focus', '[data-pcc-page-redaction-range=include]', function () {
                    var $el = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-page-redaction="redactRange"]');

                    viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-radio="' + $el.data('pccRadio') + '"]').removeClass('pcc-checked');
                    $el.addClass('pcc-checked');

                    updatePageRedactionOverlayRangeInputs();
                })
                .on('keyup', '[data-pcc-page-redaction-range=exclude]', function (ev) {
                    var $target = $(ev.target);
                    validateRangeAndUpdateErrorClass($target, {emptyIsValid: true, allIsValid: false});
                })
                .on('keyup', '[data-pcc-page-redaction-range=include]', function (ev) {
                    var $target = $(ev.target);
                    validateRangeAndUpdateErrorClass($target, {allIsValid: true});
                })

                // Toggle nodes
                .on('click', '[data-pcc-toggle]', function (ev) {
                    toggleNodes(ev, viewer.viewerNodes.$contextMenu);
                })

                // Select box dropdown menu click
                .on('click', '.pcc-dropdown div', function (ev) {
                    var $target = $(ev.target),
                        $div = $(this),
                        $parent = $target.parents('.pcc-select');

                    if (options.enableMultipleRedactionReasons) {
                        if ($div.hasClass('pcc-clear-redaction-reasons')) {
                            viewer.fullPageRedactionReason = [];

                            // Update the UI
                            setPageRedactionDropdownLabel(PCCViewer.Language.data.pageRedactionOverlay.selectReason);
                            $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked').removeClass('pcc-checked');
                        } else if ($div.hasClass('pcc-custom-redaction-reasons')) {
                            var freeformReason = getMultipleRedactionReasonsText(viewer.fullPageRedactionReason);
                            viewer.fullPageRedactionReason = [freeformReason];

                            // Update the UI
                            viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason-input]').val(freeformReason).show().focus();
                            $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked').removeClass('pcc-checked');
                            setPageRedactionDropdownLabel(PCCViewer.Language.data.redactionReasonFreeform);
                        } else {
                            ev.stopPropagation();
                            $div.toggleClass('pcc-checked');

                            // collect all checked reasons
                            var $checkedReasons = $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked');
                            var reasons = [];
                            $checkedReasons.each(function(index){
                                reasons.push($(this).find('.pcc-select-multiple-redaction-reason').text());
                            });
                            viewer.fullPageRedactionReason = reasons;
                            setPageRedactionDropdownLabel(getMultipleRedactionReasonsText(viewer.fullPageRedactionReason));
                        }
                    } else {
                        if ($div.hasClass('pcc-clear-redaction-reasons')) {
                            viewer.fullPageRedactionReason = '';
                            setPageRedactionDropdownLabel(PCCViewer.Language.data.pageRedactionOverlay.selectReason);
                        } else if ($div.hasClass('pcc-custom-redaction-reasons')) {
                            viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason-input]').val(viewer.fullPageRedactionReason);
                            setPageRedactionDropdownLabel(PCCViewer.Language.data.redactionReasonFreeform);
                        } else {
                            viewer.fullPageRedactionReason = $div.find('.pcc-select-multiple-redaction-reason').text();
                            setPageRedactionDropdownLabel(viewer.fullPageRedactionReason);
                        }
                    }

                    if ($div.hasClass('pcc-custom-redaction-reasons')) {
                        viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason-input]').show().focus();
                    } else {
                        viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-redaction-reason-input]').hide();
                    }
                })

                // Submit
                .on('click', '[data-pcc-page-redaction="submit"]', function () {
                    // Extract data from the page redaction overlay form. This data will be used to
                    // create full page rectangle redactions to the user's specification.
                    var checkedClass = 'pcc-checked',
                        isCurrent = viewer.$dom.find('[data-pcc-page-redaction=redactCurrentPage]').hasClass(checkedClass),
                        isRange = viewer.$dom.find('[data-pcc-page-redaction=redactRange]').hasClass(checkedClass),
                        isAll = viewer.$dom.find('[data-pcc-page-redaction=redactAllPages]').hasClass(checkedClass),
                        includeRangeVal = getInputValueNotPlaceholder(viewer.$dom.find('[data-pcc-page-redaction-range=include]')).toLowerCase(),
                        excludeRangeVal = getInputValueNotPlaceholder(viewer.$dom.find('[data-pcc-page-redaction-range=exclude]')).toLowerCase(),
                        pageCount = viewer.viewerControl.getPageCount(),
                        includeRangeIsValid = PCCViewer.Util.validatePageRange(includeRangeVal, {upperLimit: pageCount}),
                        excludeRangeIsValid = (excludeRangeVal.length === 0 ||
                            PCCViewer.Util.validatePageRange(excludeRangeVal, {upperLimit: pageCount})) && excludeRangeVal !== 'all',
                        pages,
                        tmplData = _.extend({
                            show: 'status'
                        }, PCCViewer.Language.data);

                    // Get an array that contains the page number of the pages that the user specified to redact.
                    // This is based on the selected options on the page redaction overlay form and the specified
                    // include or exclude ranges.
                    if (isAll) {
                        if (excludeRangeIsValid) {
                            pages = _.difference(_.range(1, pageCount + 1), PCCViewer.Util.convertPageRangeToArray(excludeRangeVal, {
                                allowEmpty: true
                            }));
                        } else {
                            viewer.notify({message: PCCViewer.Language.data.pageRedactionExcludeRangeError});
                        }
                    } else if (isRange) {
                        if (includeRangeIsValid) {
                            pages = PCCViewer.Util.convertPageRangeToArray(includeRangeVal, {upperLimit: pageCount});
                        } else {
                            viewer.notify({message: PCCViewer.Language.data.pageRedactionIncludeRangeError});
                        }
                    } else if (isCurrent) {
                        pages = [viewer.viewerControl.getPageNumber()];
                    }

                    if (pages) {
                        viewer.viewerNodes.$pageRedactionOverlay.html(_.template(options.template.pageRedactionOverlay)(tmplData)).addClass('pcc-open');
                        viewer.viewerNodes.$overlayFade.show();

                        // Get page attributes, and update the progress bar as we go along
                        requestPageAttributesAndUpdateProgressBar(pages).then(
                            // Once we have page attributes for all of the specified pages,
                            // create full page RectangleRedactions on each page. Then close
                            // the Page Redaction overlay.
                            function onFulfilled(allPageAttributes) {
                                if (!viewer.isPageRedactionCanceled) {
                                    // Update status message.
                                    viewer.$dom.find('[data-pcc-page-redaction=resultCount]').html(PCCViewer.Language.data.pageRedactionOverlay.creatingRedactions);

                                    // Show percentage and update load bar. We have one more step than the number of
                                    // pages specified. The last step is to sychronously create all of the redaction marks.
                                    var percent = Math.round(100 * (pages.length / (pages.length + 1))) + '%';
                                    viewer.$dom.find('[data-pcc-page-redaction=resultPercent]').html(percent);
                                    viewer.$dom.find('[data-pcc-page-redaction=loader]').css('width', percent);

                                    // Now that we have page attributes for all pages, we create a rectangle redaction
                                    // for each page that covers the full page.
                                    _.each(allPageAttributes, function (pageAttributes, index) {
                                        var pageNumber = pages[index];

                                        // Use ViewerControl#addMark to add the rectangle redaction to the page.
                                        var redaction = viewer.viewerControl.addMark(pageNumber, PCCViewer.Mark.Type.RectangleRedaction)
                                            .setRectangle({
                                                x: 0,
                                                y: 0,
                                                width: pageAttributes.width,
                                                height: pageAttributes.height
                                            })
                                            .setInteractionMode(PCCViewer.Mark.InteractionMode.SelectionDisabled);

                                        // If a redaction reason was set by the user in the page redaction overlay form,
                                        // then we apply the redaction reason here.
                                        if (viewer.fullPageRedactionReason && viewer.fullPageRedactionReason.length > 0) {
                                            if (options.enableMultipleRedactionReasons) {
                                                redaction.setReasons(viewer.fullPageRedactionReason);
                                            } else {
                                                redaction.setReason(viewer.fullPageRedactionReason);
                                            }
                                        }
                                    });
                                }

                                // Close the
                                viewer.viewerNodes.$pageRedactionOverlay.removeClass('pcc-open');
                                viewer.viewerNodes.$overlayFade.hide();
                            },
                            // If there was an issue getting page attributes for any of the pages,
                            // notify the user through the viewer's notification dialog and then
                            // hide the Page Redaction overlay
                            function onRejected(reason) {
                                // Notify the user of error and close the page redaction dialog.
                                viewer.notify({message: PCCViewer.Language.data.pageRedactionAttributeRequestError});
                                viewer.viewerNodes.$pageRedactionOverlay.removeClass('pcc-open');
                                viewer.viewerNodes.$overlayFade.hide();
                            });
                    }
                })

                // Prevent default behavior of buttons inside the page redaction overlay menu to prevent form submission.
                .on('click', 'button', function (ev) {
                    ev.preventDefault();
                });

            // Launch print modal
            viewer.viewerNodes.$printLaunch.on('click', function (ev) {
                var tmplData = _.extend({
                    canPrintMarks: viewer.viewerControl.canPrintMarks(),
                    show: 'form'
                }, PCCViewer.Language.data);

                viewer.viewerNodes.$printOverlay.html(_.template(options.template.printOverlay)(tmplData)).addClass('pcc-open');
                viewer.viewerNodes.$overlayFade.show();

                parseIcons(viewer.viewerNodes.$printOverlay);
                placeholderPolyfill();
                setOrientation();
                checkDropdowns();
            });

            function setOrientation() {
                // Determine whether document is landscape or portrait
                // Promises do not guarantee synchronous execution


                viewer.viewerControl.requestPageAttributes(1).then(function (attributes) {

                    var orientation = attributes.width > attributes.height ? 'landscape' : 'portrait';
                    viewer.viewerNodes.$printOverlay.find('[data-pcc-select="orientation"]').val(orientation);
                });
            }

            function checkDropdowns() {
                var annotationsEnabled = viewer.$dom.find('[data-pcc-checkbox="printAnnotations"]').hasClass('pcc-checked');
                var redactionsEnabled = viewer.$dom.find('[data-pcc-checkbox="printRedactions"]').hasClass('pcc-checked');

                if (annotationsEnabled || redactionsEnabled) {
                    viewer.$dom.find('[data-pcc-select="printComments"]').prop('disabled', false);

                } else {
                    viewer.$dom.find('[data-pcc-select="printComments"]').prop('disabled', true);
                }

                if(redactionsEnabled){
                    viewer.$dom.find('[data-pcc-select="printReasons"]').prop('disabled', false);
                    viewer.$dom.find('[data-pcc-checkbox="printRedactionViewMode"]').removeClass('pcc-disabled');
                }
                else{
                    viewer.$dom.find('[data-pcc-select="printReasons"]').prop('disabled', true);
                    viewer.$dom.find('[data-pcc-checkbox="printRedactionViewMode"]').addClass('pcc-disabled');
                }
            }

            // Print modal
            viewer.viewerNodes.$printOverlay
                // Cancel button
                .on('click', '[data-pcc-print="cancel"]', function () {
                    viewer.viewerNodes.$printOverlay.removeClass('pcc-open');
                    viewer.viewerNodes.$overlayFade.hide();
                    if (viewer.printRequest.cancel) {
                        viewer.printRequest.cancel();
                    }
                })

                .on('click', '[data-pcc-print="optionsToggle"]', function () {
                    var moreOptions = viewer.viewerNodes.$printOverlay.find(".pcc-print-more-options");

                    if(moreOptions.is(':visible')){
                        $(this).find("label").html(PCCViewer.Language.data.printMoreOptions);
                        $(this).find("span").removeClass().addClass("pcc-arrow-down");
                    }
                    else {
                        $(this).find("label").html(PCCViewer.Language.data.printLessOptions);
                        $(this).find("span").removeClass().addClass("pcc-arrow-up");
                    }

                    viewer.viewerNodes.$printOverlay.find(".pcc-print-more-options").slideToggle();
                })

                // Radio buttons
                .on('click', '[data-pcc-radio]', function (ev) {
                    var $el = $(ev.currentTarget);
                    var $siblings = viewer.$dom.find('[data-pcc-radio="' + $el.data('pccRadio') + '"]').not(this);

                    $el.addClass('pcc-checked');
                    $siblings.removeClass('pcc-checked');
                })

                // Checkboxes
                .on('click', '[data-pcc-checkbox]', function (ev) {
                    var $el = $(ev.currentTarget);
                    if ($el.hasClass('pcc-disabled')) {
                        return;
                    }

                    $el.toggleClass('pcc-checked');
                    checkDropdowns();
                })

                // Page range
                .on('focus', '[data-pcc-print="range"]', function () {
                    var $el = viewer.$dom.find('[data-pcc-print-page="printRange"]');
                    var $siblings = viewer.$dom.find('[data-pcc-radio="' + $el.data('pccRadio') + '"]').not(this);

                    $el.addClass('pcc-checked');
                    $siblings.removeClass('pcc-checked');
                })
                .on('keyup', '[data-pcc-print="range"]', function (ev) {
                    var $target = $(ev.target),
                        isValid = viewer.viewerControl.validatePrintRange(getInputValueNotPlaceholder($target)),
                        errorClass = 'pccError';

                    if (isValid) {
                        $target.removeClass(errorClass);
                    } else {
                        $target.addClass(errorClass);
                    }
                })

                // Print submit
                .on('click', '[data-pcc-print="submit"]', function () {
                    var tmplData = {},
                        checkedClass = 'pcc-checked',
                        errorClass = 'pccError',
                        isCurrent = viewer.$dom.find('[data-pcc-print-page="printCurrentPage"]').hasClass(checkedClass),
                        isRange = viewer.$dom.find('[data-pcc-print-page="printRange"]').hasClass(checkedClass),
                        rangeVal = getInputValueNotPlaceholder(viewer.$dom.find('[data-pcc-print="range"]')),
                        rangeIsValid = viewer.viewerControl.validatePrintRange(rangeVal),
                        orientation = viewer.$dom.find('[data-pcc-select="orientation"]').val(),
                        paperSize = viewer.$dom.find('[data-pcc-select="paperSize"]').val(),
                        annotationsEnabled = viewer.$dom.find('[data-pcc-checkbox="printAnnotations"]').hasClass(checkedClass),
                        redactionsEnabled = viewer.$dom.find('[data-pcc-checkbox="printRedactions"]').hasClass(checkedClass),
                        margins = viewer.$dom.find('[data-pcc-checkbox="printMargins"]').hasClass(checkedClass) ? 'default' : 'none',
                        commentsPrintLocation = viewer.$dom.find('[data-pcc-select="printComments"]').val(),
                        reasonsPrintLocation = viewer.$dom.find('[data-pcc-select="printReasons"]').val(),
                        printOptions = {
                            range: isCurrent ? viewer.viewerControl.getPageNumber().toString() : (isRange ? rangeVal : 'all'),
                            orientation: orientation,
                            paperSize:paperSize,
                            includeMarks: annotationsEnabled,
                            includeAnnotations: annotationsEnabled,
                            includeRedactions: redactionsEnabled,
                            margins: margins,
                            includeComments: commentsPrintLocation,
                            includeReasons: reasonsPrintLocation,
                            redactionViewMode: viewer.viewerNodes.$printOverlay.find('[data-pcc-checkbox="printRedactionViewMode"]').hasClass('pcc-checked') ? "Draft" : "Normal"
                        },
                        percent = 0,
                        dismissOverlay = function () {
                            viewer.viewerNodes.$printOverlay.removeClass('pcc-open');
                            viewer.viewerNodes.$overlayFade.hide();
                        };

                    if (!annotationsEnabled && !redactionsEnabled) {
                        commentsPrintLocation = 'none';
                        printOptions.includeComments = commentsPrintLocation;
                    }

                    if (!redactionsEnabled) {
                        reasonsPrintLocation = 'none';
                        printOptions.includeReasons = reasonsPrintLocation;
                        printOptions.redactionViewMode = "Normal";
                    }

                    if (!isRange || isRange && rangeIsValid) {
                        viewer.printRequest = viewer.viewerControl.print(printOptions);
                        viewer.viewerNodes.$printOverlay.html(_.template(options.template.printOverlay)(PCCViewer.Language.data)).addClass('pcc-open');
                        viewer.viewerNodes.$overlayFade.show();

                        viewer.printRequest
                            // As each page is prepared.
                            .on(PCCViewer.PrintRequest.EventType.PrintPagePrepared, function () {
                                percent = Math.round(100 * (viewer.printRequest.getPreparedCount() / viewer.printRequest.getPageCount())) + '%';

                                // Show page count.
                                viewer.$dom.find('[data-pcc-print="resultCount"]').html(PCCViewer.Language.data.printPreparingPage + ' ' + viewer.printRequest.getPreparedCount() + ' ' + PCCViewer.Language.data.printPreparingPageOf + ' ' + viewer.printRequest.getPageCount());

                                // Show percentage and update load bar.
                                viewer.$dom.find('[data-pcc-print="resultPercent"]').html(percent);
                                viewer.$dom.find('[data-pcc-print="loader"]').css('width', percent);
                            })

                            // When the print job has been prepared hide overlay.
                            .on(PCCViewer.PrintRequest.EventType.PrintCompleted, function () {
                                dismissOverlay();
                            })

                            // The print completed due to failure, hide overlay and show error.
                            .on(PCCViewer.PrintRequest.EventType.PrintFailed, function () {
                                dismissOverlay();
                                viewer.notify({message: PCCViewer.Language.data.printFailedError});
                            });

                    }
                    if (isRange && !rangeIsValid) {
                        viewer.notify({message: PCCViewer.Language.data.printRangeError});
                        viewer.$dom.find('[data-pcc-print="range"]').addClass(errorClass);
                    }
                })

                // Prevent default behavior of buttons inside the print menu to prevent form submission.
                .on('click', 'button', function (ev) {
                    ev.preventDefault();
                });

            // Context Menu
            viewer.viewerNodes.$contextMenu
                // Toggle nodes
                .on('click', '[data-pcc-toggle]', function (ev) {
                    toggleNodes(ev, viewer.viewerNodes.$contextMenu);
                })

                // Select box dropdown menu click
                .on('click', '.pcc-dropdown div', function (ev) {
                    var $target = $(ev.target),
                        $parent = $target.parents('.pcc-select'),
                        $dropdown = $parent.find('.pcc-dropdown'),
                        $div = $(this),
                        option = $target.text(),
                        mark = viewer.currentMarks[0],
                        fillColor = '',
                        opacity = 0,
                        borderWidth = 0,
                        borderColor = '',
                        fontColor = '',
                        fontName = '',
                        fontSize = '',
                        stampLabel = '',
                        redactionReason = '',
                        backgroundColor;

                    // Handle nested element clicks
                    if ($target[0].nodeName.toLowerCase() === 'span') {
                        option = $target.parent().text();
                    }

                    if ($parent.hasClass('pcc-select-color')) {

                        if ($target.hasClass('pcc-transparent-effect')) {
                            $parent.find('.pcc-swatch').addClass('pcc-transparent-effect').css('background', 'none');
                        } else {
                            $parent.find('.pcc-swatch').removeClass('pcc-transparent-effect').css('background-color', $target.css('background-color'));
                        }

                    } else if ($parent.hasClass('pcc-select-redaction-reason')) {
                        $div.toggleClass('pcc-checked');
                    } else {
                        $parent.find('.pcc-label').text(option);
                    }

                    // Set selected mark properties
                    if (mark) {
                        // Fill color
                        if ($parent.data().pccFillColor !== undefined) {
                            backgroundColor = $target[0].style.backgroundColor;

                            if ($target.data('pccColorKey')) {
                                fillColor = $target.data('pccColorKey');
                            } else if ( backgroundColor.indexOf('rgb') > -1 ) {
                                fillColor = rgbToHex(backgroundColor);
                            } else {
                                fillColor = backgroundColor;
                            }

                            if (mark.setColor) {
                                mark.setColor(fillColor);
                            } else if (mark.setFillColor) {
                                mark.setFillColor(fillColor);
                            }
                        }

                        // Fill opacity
                        if ($parent.data().pccFillOpacity !== undefined) {
                            opacity = Math.round(parseInt(option.replace(/\%/g, ''), 10) * 2.55);
                            mark.setOpacity(opacity);
                        }

                        // Border color
                        if ($parent.data().pccBorderColor !== undefined) {

                            backgroundColor = $target[0].style.backgroundColor;

                            if ($target.data('pccColorKey')) {
                                borderColor = $target.data('pccColorKey');
                            } else if ( backgroundColor.indexOf('rgb') > -1 ) {
                                borderColor = rgbToHex(backgroundColor);
                            } else {
                                borderColor = backgroundColor;
                            }

                            mark.setBorderColor(borderColor);
                        }

                        // Border width
                        if ($parent.data().pccBorderWidth !== undefined) {
                            borderWidth = parseInt(option.replace(/^\s+|\s+$/g, ''), 10);

                            if (mark.setThickness) {
                                mark.setThickness(borderWidth);

                            } else if (mark.setBorderThickness) {
                                mark.setBorderThickness(borderWidth);
                            }
                        }

                        // Font color
                        if ($parent.data().pccFontColor !== undefined) {
                            fontColor = rgbToHex($target[0].style.backgroundColor);
                            mark.setFontColor(fontColor);
                        }

                        // Font name
                        if ($parent.data().pccFontName !== undefined) {
                            fontName = option;
                            mark.setFontName(fontName);
                        }

                        // Font size
                        if ($parent.data().pccFontSize !== undefined) {
                            fontSize = option;
                            mark.setFontSize(parseFloat(fontSize));
                        }

                        // Stamp label
                        if ($parent.data().pccStampLabel !== undefined) {
                            stampLabel = option;
                            mark.setLabel(stampLabel);
                        }

                        // Redaction reason
                        if ($parent.data().pccRedactionReason !== undefined) {
                            var remainActive = false;
                            var isRedactionItem = $div.hasClass('pcc-checkbox');

                            if (options.enableMultipleRedactionReasons) {
                                if ($div.hasClass('pcc-clear-redaction-reasons')) {
                                    mark.setReasons([]);
                                } else if ($div.hasClass('pcc-custom-redaction-reasons')) {
                                    var freeformReason = getMultipleRedactionReasonsText(mark.getReasons());
                                    mark.setReasons([freeformReason]);
                                    remainActive = true;
                                } else {
                                    // collect all checked reasons
                                    var $checkedReasons = $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked');
                                    var reasons = [];
                                    $checkedReasons.each(function(index){
                                        reasons.push($(this).find('.pcc-select-multiple-redaction-reason').text());
                                    });
                                    mark.setReasons(reasons);
                                    remainActive = true;
                                }
                            } else {
                                if ($div.hasClass('pcc-clear-redaction-reasons')) {
                                    mark.setReason('');
                                } else if ($div.hasClass('pcc-custom-redaction-reasons')) {
                                    remainActive = true;
                                    // no need to change mark reason
                                } else {
                                    var reason = $div.find('.pcc-select-multiple-redaction-reason').text();
                                    mark.setReason(reason);
                                }
                            }

                            updateContextMenu({
                                showContextMenu: true,
                                enableCustomRedactionReason: $div.hasClass('pcc-custom-redaction-reasons'),
                                scrollTop: $dropdown.scrollTop(),
                                remainActive: remainActive,
                                showAllEditControls: mark.getPageNumber() !== 0 // Don't show edit controls for template marks
                            });

                            if (isRedactionItem && options.enableMultipleRedactionReasons) {
                                var $contextMenu = viewer.$dom.find('.pcc-context-menu');
                                var $redactionReasonsSelect = $contextMenu.find('.pcc-select-redaction-reason');
                                var $redactionReasonsDropdown = $redactionReasonsSelect.find('.pcc-dropdown');

                                $redactionReasonsSelect.addClass('pcc-active');
                                $redactionReasonsDropdown.addClass('pcc-open');
                                ev.stopPropagation();
                            }
                        }
                    }
                })

                // Set font style array
                .on('click', '[data-pcc-font-style]', function (ev) {
                    var $target = $(ev.target).closest('button'),
                        str = $target.data('pccFontStyle'),
                        mark = viewer.currentMarks[0];

                    $target.toggleClass('pcc-active');

                    if (mark) {
                        var arr = mark.getFontStyle();

                        if (_.indexOf(arr, str) === -1) {
                            arr.push(str);
                        } else {
                            arr.splice(_.indexOf(arr, str), 1);
                        }

                        mark.setFontStyle(arr);
                    }
                })

                // Set font text alignment
                // Each click cycles through an array of 0-2 returning 0, 1, or 2
                .on('click', '[data-pcc-font-align]', function (ev) {
                    var $target = $(ev.target).closest('button'),
                        counter = $target.data('counter'),
                        i = counter ? counter + 1: 1,
                        mark = viewer.currentMarks[0],
                        arr = [PCCViewer.Mark.HorizontalAlignment.Left, PCCViewer.Mark.HorizontalAlignment.Center, PCCViewer.Mark.HorizontalAlignment.Right];

                    // On 3 start back at 0
                    i = (i === 3) ? 0 : i;

                    // Change the icon and tooltip to Left Align, Center Align, or Right Align
                    $target.data('counter', i).attr({
                        'class': 'pcc-icon pcc-icon-text-' + arr[i].toLowerCase(),
                        title: PCCViewer.Language.data['paragraphAlign' + arr[i]]
                    });

                    updateIcon($target);

                    if (mark) {
                        mark.setHorizontalAlignment(arr[i]);
                    }
                })

                // Delete marks button
                .on('click', '[data-pcc-delete-mark]', function (ev) {
                    viewer.viewerControl.deleteMarks(viewer.currentMarks);
                })

                .on('click', '[data-pcc-add-comment-context-menu]', function (ev) {
                    if (viewer.currentMarks.length) {
                        commentUIManager.addComment(viewer.currentMarks[0].getConversation());
                    }
                })

                // Move context menu up/down button
                .on('click', '[data-pcc-move-context-menu]', function (ev) {
                    viewer.viewerNodes.$contextMenu.toggleClass('pcc-move-bottom');
                    updateContextMenuDropdownsMaxHeight();
                })

                // Move mark layer order
                .on('click', '[data-pcc-move-mark]', function (ev) {
                    viewer.viewerControl['moveMark' + $(ev.target).data('pccMoveMark')](viewer.currentMarks[0]);
                })

                // Checkbox click
                .on('click', '[data-pcc-checkbox="includeInBurnedDocument"]', function (ev) {
                    var $this = $(this),
                        wasChecked = $this.hasClass('pcc-checked'),
                        marks = viewer.currentMarks;

                    // Toggle the checked state of the mark
                    $this.toggleClass('pcc-checked');

                    // If the checkbox was checked, remove the data
                    marks.forEach(function (mark) {
                        mark.setData('Accusoft-burnAnnotation', !wasChecked ? '1' : undefined);
                    });
                })

                // Prevent default behavior of buttons inside the context menu to prevent form submission.
                .on('click', 'button', function (ev) {
                    ev.preventDefault();
                });

            function mouseToolSelectHandler(ev){
                var $target = $(ev.currentTarget),
                    mouseToolName = $target.data('pccMouseTool'),
                    mouseTool = PCCViewer.MouseTools.getMouseTool(mouseToolName);

                if (!mouseToolName || mouseTool.getType() === PCCViewer.MouseTool.Type.PlaceSignature) {
                    // mouse tool has no name or should be skipped
                    // skipped mouse tools have logic to use them elsewhere in this file
                    return;
                }

                // Some mouse tools buttons can be in a disabled state. For example, the select text mouse
                // tool button is disabled before we determine if there is text in the document.
                if ($target.hasClass('pcc-disabled')) {
                    return;
                }

                // We can handle this event, so prevent default -- this event should not be handled anywhere else
                ev.preventDefault();

                // deselect marks if selecting another mouse tool that's not edit
                if (mouseTool.getType() !== PCCViewer.MouseTool.Type.EditMarks) {
                    viewer.viewerControl.deselectAllMarks();
                }

                viewer.setMouseTool({
                    mouseToolName: mouseToolName,
                    thisButton: $target,
                    sourceType: ev.type
                });
            }

            // Mouse tool buttons
            this.viewerNodes.$mouseTools.on('click', function (ev) {
                mouseToolSelectHandler(ev);
            });

            // For a number input tag, entering a non-digit character invalidates the entire input, rather than
            // giving access to the invalid value for JavaScript validation. We want the number input to trigger
            // the number keyboard on Android and iOS. So instead, we will filter out invalid characters before
            // they are populated in the intup field.
            viewer.viewerNodes.$pageSelect.on("keydown", function (ev) {
                // jQuery cancels the event based on true/false return value
                // if using anything other than jQuery, this event needs to be cancelled, prevent default, and prevent bubbling manually

                switch (ev.keyCode) {
                    // Tab
                    case 9:
                        // Fall through
                    // Enter
                    case 13:
                        ev.target.blur();
                        return false;
                    // Backspace
                    case 8:
                        // Fall through
                    // Delete
                    case 46:
                        return true;
                    // Non-number keys on the Android number keyboard
                    case 0:
                        return false;
                }

                var arrows = function () {
                    // Keyboard arrow keys
                    return (ev.keyCode >= 37 && ev.keyCode <= 40);
                };
                var numPad = function () {
                    // Number pad keys are 96 - 105 (NumLock is on)
                    return (ev.keyCode >= 96 && ev.keyCode <= 105);
                };
                var numKeys = function () {
                    // Check if original event provides keyIdentifier
                    if (ev.originalEvent && ev.originalEvent.keyIdentifier) {
                        // Numbers are U+30 - U+39 (modern browsers have these)
                        var key = parseInt(ev.originalEvent.keyIdentifier.replace(/U\+/, ''), 10);
                        return (key >= 30 && key <= 39);
                    }
                    // Regular number keys are 48 - 57
                    return (ev.keyCode >= 48 && ev.keyCode <= 57) && !ev.shiftKey;
                };

                if (numPad() || numKeys() || arrows()) { return true; }
                else { return false; }
            });
            // When the input changes, we can trigger the page change. We already know this will be
            // a number, since all other characters have been filtered out.
            viewer.viewerNodes.$pageSelect.on("change", function (ev) {
                var val = $(ev.target).val();

                if (val.length > 0) {
                    // Validate that page number entered is not less than pagecount
                    if (val > viewer.viewerControl.getPageCount() || val < 1) {
                        // Add error class
                        ev.target.className += ' pccError';
                        setTimeout(function () {
                            // Remove error class
                            ev.target.className = ev.target.className.replace('pccError', '');
                            $(ev.target).val(viewer.viewerControl.getPageNumber());
                        }, 1200);
                        return;
                    }

                    viewer.viewerNodes.$pageSelect.val(val);
                    if (typeof viewer.viewerControl.setPageNumber === 'function') {
                        viewer.viewerControl.setPageNumber(+val);
                    }

                } else {
                    // Put current page number back
                    $(ev.target).val(viewer.viewerControl.getPageNumber());
                }
            });

            //allows the redaction marks to show/hide underneath document content text
            viewer.viewerNodes.$redactionViewMode.on('click', function () {
                var redactionViewMode = viewer.viewerControl.getRedactionViewMode();
                if (redactionViewMode === "Draft") {
                    viewer.viewerControl.setRedactionViewMode('Normal');
                    viewer.viewerNodes.$redactionViewMode.removeClass('pcc-active');
                }
                else {
                    viewer.viewerControl.setRedactionViewMode('Draft');
                    viewer.viewerNodes.$redactionViewMode.addClass('pcc-active');
                }
            });

            // Tab navigation
            viewer.viewerNodes.$tabItems.on('click', function (ev) {
                var $el = $(ev.currentTarget),
                    $elTrigger = viewer.$dom.find('.pcc-trigger'),
                    $elTabItem = viewer.$dom.find('.pcc-tab-item'),
                    $elDialogs = viewer.viewerNodes.$dialogs,
                    $elContextMenu = viewer.$dom.find('.pcc-context-menu'),
                    $thisTabPane = $el.parents('.pcc-tab').find('.pcc-tab-pane'),
                    menuItemHeight = $elTrigger.height(),
                    menuIncr = menuItemHeight,
                    windowWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth,
                    leftOffsetClass = 'pcc-vertical-offset-left',
                    rightOffsetClass = 'pcc-vertical-offset-right';

                $elTabItem.removeClass('pcc-active');
                $elTrigger.html($el.html());

                // On small viewports, show drop menu
                if (windowWidth <= viewer.tabBreakPoint) {
                    $elTabItem.toggleClass('pcc-open');

                    // Hide the menu item, adjust top css property of menu items
                    if ($el.hasClass('pcc-trigger')) {
                        viewer.$dom.find('.pcc-tab-item:not(.pcc-trigger)').removeClass('pcc-hide');
                        viewer.$dom.find('.pcc-tab-item:not(.pcc-trigger):contains("' + $el.text().replace(/^\s+|\s+$/g, '') + '")').addClass('pcc-hide');
                        _.each(viewer.$dom.find('.pcc-tabset .pcc-tab-item'), function (item) {
                            menuIncr = $(item).parent().prev().find('.pcc-tab-item').hasClass('pcc-hide') ? 0 : menuIncr;
                            $(item).css('top', ($(item).parent().index() * menuItemHeight) + menuIncr + 'px');
                        });
                    }
                }

                $el.addClass('pcc-active');
                $el.parents('.pcc-tab').siblings().find('.pcc-tab-pane').removeClass('pcc-open');

                $thisTabPane.addClass('pcc-open');

                // Add offset to dialogs, context menu, pagelist
                if ($thisTabPane.hasClass('pcc-tab-vertical pcc-right')) {
                    $elDialogs.removeClass(leftOffsetClass).addClass(rightOffsetClass);
                    $elContextMenu.removeClass(leftOffsetClass).addClass(rightOffsetClass);
                    viewer.viewerNodes.$pageList.removeClass(leftOffsetClass).addClass(rightOffsetClass);
                }
                else if ($thisTabPane.hasClass('pcc-tab-vertical')) { // Assumes .left (default)
                    $elDialogs.removeClass(rightOffsetClass).addClass(leftOffsetClass);
                    $elContextMenu.removeClass(rightOffsetClass).addClass(leftOffsetClass);
                    viewer.viewerNodes.$pageList.removeClass(rightOffsetClass).addClass(leftOffsetClass);
                }
                else if (!$el.hasClass('pcc-trigger')) {
                    $elDialogs.removeClass(leftOffsetClass).removeClass(rightOffsetClass);
                    $elContextMenu.removeClass(leftOffsetClass).removeClass(rightOffsetClass);
                    viewer.viewerNodes.$pageList.removeClass(leftOffsetClass).removeClass(rightOffsetClass);
                }

                // Add class to offset pagelist when vertical dialogs are present
                toggleDialogOffset();
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });

            // Toggle nodes
            viewer.viewerNodes.$toggles.on('click', function (ev) {
                toggleNodes(ev);
            });

            // Search buttons
            viewer.viewerNodes.$searchSubmit.on('click', function (ev) {
                // prevent this event from firing anything else
                ev.stopPropagation();

                // prevent default behavior of button to prevent postback
                ev.preventDefault();

                viewer.search.executeSearch();
            });

            viewer.viewerNodes.$searchCancel.on('click', function (ev) {
                viewer.search.cancelSearch();
            });

            viewer.viewerNodes.$searchInput.on('keydown', function (ev) {
                if (ev.keyCode === 13 || ev.keyCode === 9) {
                    ev.preventDefault();
                    viewer.search.executeSearch();
                }
            });

            viewer.viewerNodes.$searchPrevResult.on('click', function (ev) {
                ev.preventDefault();
                viewer.search.previousResultClickHandler(this);

            });
            viewer.viewerNodes.$searchNextResult.on('click', function (ev) {
                ev.preventDefault();
                viewer.search.nextResultClickHandler(this);
            });

            viewer.viewerNodes.$revisionPrevItem.on('click', function (ev) {
                ev.preventDefault();
                viewer.revision.previousRevisionClickHandler(this);

            });
            viewer.viewerNodes.$revisionNextItem.on('click', function (ev) {
                ev.preventDefault();
                viewer.revision.nextRevisionClickHandler(this);
            });

            viewer.viewerNodes.$searchClear.on('click', function (ev) {
                viewer.search.clearSearch(ev);
                toggleDialogOffset();
            });
            viewer.viewerNodes.$searchToggleAllPresets.on('click', function (ev) {
                ev.stopPropagation();

                var checked = false,
                    dataID = 'pcc-toggled';

                if ($(this).data(dataID)) {
                    checked = false;
                    $(this).data(dataID, false);
                } else {
                    checked = true;
                    $(this).data(dataID, true);
                }
                viewer.$dom.find('[data-pcc-predefined-search] input').prop('checked', checked);
            });

            viewer.viewerNodes.$searchExactPhrase.on('click', function (ev) {
                return viewer.search.exactPhraseClickHandler(this);
            });
            viewer.viewerNodes.$searchMatchCase.on('click', function (ev) {
                return viewer.search.matchCaseClickHandler(this);
            });
            viewer.viewerNodes.$searchMatchWholeWord.on('click', function(ev) {
                return viewer.search.matchWholeWordClickHandler(this);
            });
            viewer.viewerNodes.$searchBeginsWith.on('click', function(ev) {
                return viewer.search.beginsWithClickHandler(this);
            });
            viewer.viewerNodes.$searchEndsWith.on('click', function(ev) {
                return viewer.search.endsWithClickHandler(this);
            });
            viewer.viewerNodes.$searchWildcard.on('click', function(ev) {
                return viewer.search.wildcardClickHandler(this);
            });
            viewer.viewerNodes.$searchProximity.on('click', function(ev) {
                return viewer.search.proximityClickHandler(this);
            });
            viewer.$dom.find('[data-pcc-nav-tab=search]').on('click', function () {
                viewer.viewerNodes.$searchInput.focus();
            });

            // Create a reusable function for dropdowns.
            // We can use this one for dropdowns in overlays
            function handleDropdownBehavior(ev) {
                var isSelect = $(ev.target).parents().hasClass('pcc-select'),
                    isLoadMarkup = $(ev.target).parents().hasClass('pcc-select-load-annotations'),
                    isLoadMarkupLayers = $(ev.target).parents().hasClass('pcc-select-load-annotation-layers'),
                    $selection = $(ev.target).is('span') ? $(ev.target).parent().clone() : $(ev.target).clone();

                if (isLoadMarkupLayers) {
                    $(ev.target).parents('.pcc-select').find('.pcc-label').html($(ev.target).html());
                    return;
                } else if (isSelect && !isLoadMarkup) {
                    $(ev.target).parents('.pcc-select').find('.pcc-label').replaceWith($selection.addClass('pcc-label'));
                }
            }

            // Select box dropdown menus
            viewer.viewerNodes.$dropdowns.on('click', handleDropdownBehavior);

            // On document click close open dropdown menus
            $(document).click(function (ev) {
                if (!viewer) {
                    return;
                }

                var $target = $(ev.target),
                    isSelect = $target.parents().hasClass('pcc-select'),
                    isPrevSearch = $target.data('pccToggle') === 'dropdown-search-box' || $target.parent().data('pccToggle') === 'dropdown-search-box',
                    isSearchSubmit = $target.attr('data-pcc-search') === 'submit';

                // Dont close dropdowns that allow you to select multiple options
                if (!isSelect && !isPrevSearch && !isSearchSubmit) {
                    viewer.$dom.find('.pcc-dropdown').removeClass('pcc-open').parents('.pcc-select').removeClass('pcc-active');
                }
                if (isSelect || isPrevSearch) {
                    viewer.$dom.find('.pcc-dropdown').not($target.parents('.pcc-select, .pcc-tab-pane').find('.pcc-dropdown')).removeClass('pcc-open');
                }
            });

            // Prevent default behavior of buttons inside the viewer to prevent form submission.
            viewer.$dom.on('click', 'button', function (ev) {
                ev.preventDefault();
            });
        };

        // Function to resize the eSign drawing context
        function resizeESignContext () {
            if (viewer.esignContext && viewer.esignContext.resize) {
                viewer.esignContext.resize();
            }
        }

        // A helper to dynamically adjust the max-height of context menu dropdowns
        // depends on the height of the Viewer
        function updateContextMenuDropdownsMaxHeight() {
            var $dropdowns = viewer.viewerNodes.$contextMenu.find('.pcc-dropdown');
            var heightDecrease = viewer.viewerNodes.$contextMenu.hasClass('pcc-move-bottom') ? 190 : 250;
            if (viewer.viewerNodes.$contextMenu.hasClass('pcc-move')) {
                heightDecrease += 80
            }
            var dropdownMaxHeight = Math.max(150, viewer.$dom.height() - heightDecrease);
            $dropdowns.css({'max-height': dropdownMaxHeight + 'px'});
        }

        // A helper to dynamically adjust the max-height of full page redaction dropdowns
        // depends on the height of the Viewer
        function updateFullPageRedactionDropdownsMaxHeight() {
            var $dropdowns = viewer.viewerNodes.$pageRedactionOverlay.find('.pcc-dropdown');
            var $redactAllPagesRadio = viewer.viewerNodes.$pageRedactionOverlay.find('[data-pcc-radio="pageRedaction"][data-pcc-page-redaction="redactAllPages"]');
            var heightDecrease = $redactAllPagesRadio.hasClass('pcc-checked') ? 395 : 360;
            var dropdownMaxHeight = Math.max(150, viewer.$dom.height() - heightDecrease);
            $dropdowns.css({'max-height': dropdownMaxHeight + 'px'});
        }

        // Function to return separated reasons string for the reasons array
        function getMultipleRedactionReasonsText(reasons) {
            return reasons.join('; ');
        }

        //Bind Keyboard shortcuts
        this.initKeyBindings = function() {
            //keyboard shortcuts for page navigation
            $('body').on('keydown', null, 'pageup', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        viewer.viewerControl.changeToPrevPage();
                        return false;
                    }
                }
                return true;
            });

            $('body').on('keydown', null, 'home', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        viewer.viewerControl.changeToFirstPage();
                        return false;
                    }
                }
                return true;
            });
            $('body').on('keydown', null, 'end', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        viewer.viewerControl.changeToLastPage();
                        return false;
                    }
                }
                return true;
            });
            $('body').on('keydown', null, 'pagedown', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        viewer.viewerControl.changeToNextPage();
                    }
                }
                return true;
            });
            $('body').on('keydown', null, 'Ctrl+g', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        viewer.viewerNodes.$pageSelect.focus().select();
                        return false;
                    }
                }
                return true;
            });
            function scrolling() {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {

                    if (!viewer.$pageListContainerWrapper[0]) {
                        //It is necessary to access the Dom one time at least because the initialized pccPageListContainerWrapper does not have a Div
                        viewer.$pageListContainerWrapper = viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper');
                    }
                    if ($(viewer.viewerNodes.$searchResults[0]).is(':visible')) {
                        if (document.activeElement === viewer.viewerNodes.$searchResults[0] || document.activeElement === viewer.$pageListContainerWrapper[0]) {
                            if (viewer.prevActiveElement === viewer.viewerNodes.$searchResults[0] && document.activeElement === viewer.$pageListContainerWrapper[0]) {
                                viewer.$pageListContainerWrapper.focus();
                            }
                            else if (viewer.prevActiveElement === viewer.$pageListContainerWrapper[0] && document.activeElement === viewer.viewerNodes.$searchResults[0]) {
                                viewer.viewerNodes.$searchResults.focus();
                            }

                            return;
                        }
                        else {
                            if (document.activeElement !== viewer.$pageListContainerWrapper[0]) {
                                viewer.$pageListContainerWrapper.focus();
                            }
                        }
                    }
                    else {
                        if (document.activeElement !== viewer.$pageListContainerWrapper[0]) {
                            viewer.$pageListContainerWrapper.focus();
                        }
                    }
                }
            }

            //arrow keys for page navigation
            $('body').on('keydown', null, 'down up left right', function () {
                scrolling();
                return true;
            });

            //zoomin/zoomout keyboard shortcuts
            $('body').on('keydown', null, '= +', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        if (!viewer.viewerNodes.$zoomIn[0].className.match('pcc-disabled')) {
                            viewer.viewerControl.zoomIn(1.25);
                            return false;
                        }
                    }
                }
                return true;
            });

            $('body').on('keydown', null, '-', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        if (!viewer.viewerNodes.$zoomOut[0].className.match('pcc-disabled')) {
                            viewer.viewerControl.zoomOut(1.25);
                            return false;
                        }
                    }
                }
                return true;
            });

            //Delete selected marks, use delete button
            $('body').on('keydown', null, 'del', function () {
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
                    if (!$(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        var selectedMarks = viewer.viewerControl.getSelectedMarks();
                        if (selectedMarks.length) {
                            viewer.viewerControl.deleteMarks(viewer.currentMarks);
                            return false;
                        }
                    }
                }
                return true;
            });

            //modal dialog related keyboard shortcuts for cancel
            //Note the Text esig and comments cancel button may not work if the focus
            //is still on the Text area of each of these dialogs. The user has to hit a tab key or mnually
            //change the focus with a mouse. Future work: These two dialogs need to be implemented differently for keyboard support
            $('body').on('keydown', null, 'esc', function () {
                var $cancelBtn;
                if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {

                    if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
                        if ($(viewer.viewerNodes.$esignOverlay[0]).is(':visible')) {
                            $cancelBtn = viewer.$dom.find('[data-pcc-esign="cancel"]');
                            $cancelBtn.click();
                            return false;
                        }
                        else if ($(viewer.viewerNodes.$imageStampOverlay[0]).is(':visible')) {
                            $cancelBtn = viewer.$dom.find('[data-pcc-image-stamp="closer"]');
                            $cancelBtn.click();
                            return false;
                        }
                        else if ($(viewer.viewerNodes.$pageRedactionOverlay[0]).is(':visible')) {
                            $cancelBtn = viewer.$dom.find('[data-pcc-page-redaction="cancel"]');
                            $cancelBtn.click();
                            return false;
                        }
                        else if ($(viewer.$dom.find('[data-pcc-download-overlay]')[0]).is(':visible')) {
                            viewer.$dom.find('[data-pcc-download-overlay]').find('.pcc-overlay-closer').click();
                            return false;
                        }
                        else {

                            var $printCancel = viewer.$dom.find('[data-pcc-print="cancel"]');
                            if ($($printCancel[0]).is(':visible')) {
                                //canel out the print dialog
                                $printCancel.click();
                                return false;
                            }
                        }
                    }
                    else {

                        if ($('.pccPageListAboutModal button').is(':visible')) {
                            $('.pccPageListAboutModal button').click();
                        }
                    }
                }
                return true;
            });
            //used for navigation with arrow keys puropose
            $('body').on('keydown', null, 'tab', function () {
                if (viewer.prevActiveElement === viewer.viewerNodes.$searchResults[0] || document.activeElement === viewer.$pageListContainerWrapper[0]) {
                    viewer.prevActiveElement = viewer.activeElement;
                    viewer.activeElement = document.activeElement;
                }
                return true;
            });

            //NOTE: The following commnted out code shows how to handle some of the buttons in the modal dialogs.
            //uncomment out the code and customize it per your requirements.

            ////(ctrl + enter)  saves the drawn signatures or saves the comment. Note the enter key is a 'return' as
            //// interpreted by jQuery plugin in here. Also, the Text signature textbox and teh comments Text area will have focus
            ////so the jQuery.hotkeys does not fire the event. These two dialogs will require re-implementation in the future.
            //$('body').on('keydown', null, 'ctrl+return', function () {
            //    if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
            //        if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
            //            if ($(viewer.viewerNodes.$esignOverlay[0]).is(':visible')) {
            //                var $saveBtn = viewer.$dom.find('[data-pcc-esign="save"]');
            //                $saveBtn.click();
            //            }
            //        }
            //        else {
            //            var commentPanel = viewer.$dom.find('.pccPageListComments');
            //            if ($(commentPanel[0]).is(':visible')) {
            //                var $doneBtn = viewer.$dom.find('[data-pcc-comment="done"]');
            //                $doneBtn.click();
            //                return false;
            //            }
            //        }
            //    }
            //    return true;
            //});
            ////clears drawn signature
            //$('body').on('keydown', null, 'ctrl+c', function () {
            //    if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
            //        if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
            //            if ($(viewer.viewerNodes.$esignOverlay[0]).is(':visible')) {
            //                var $clearBtn = viewer.$dom.find('[data-pcc-esign="clear"]');
            //                $clearBtn.click();
            //                return false;
            //            }
            //        }
            //    }
            //    return true;
            //});
            ////saves full page redaction
            //$('body').on('keydown', null, 'shift+r', function () {
            //    if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
            //        if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
            //            if ($(viewer.viewerNodes.$pageRedactionOverlay[0]).is(':visible')) {
            //                var $redactBtn = viewer.$dom.find('[data-pcc-page-redaction="submit"]');
            //                $redactBtn.click();
            //                return false;
            //            }
            //        }
            //    }
            //    return true;
            //});

            //// (shift + d) keys to draw new signature. It is equivalent to pressing draw new button in the free hand esig dialog
            //$('body').on('keydown', null, 'shift+d', function () {
            //    if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
            //        if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
            //            if ($(viewer.viewerNodes.$esignOverlay[0]).is(':visible')) {
            //                var $drawNewBtn = viewer.$dom.find('[data-pcc-esign="drawNew"]');
            //                $drawNewBtn.click();
            //                return false;
            //            }
            //        }
            //    }
            //    return true;
            //});
            ////(shift + t) keys for create a new Text signature. Note user will need to tab out of this to
            ////save or clear the Text input box.
            //$('body').on('keydown', null, 'shift+t', function () {
            //    if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
            //        if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
            //            if ($(viewer.viewerNodes.$esignOverlay[0]).is(':visible')) {
            //                var $typeNewBtn = viewer.$dom.find('[data-pcc-esign="typeNew"]');
            //                $typeNewBtn.click();
            //                return false;
            //            }
            //        }
            //    }
            //    return true;
            //});
            ////(shift+p) keys to send print job in the print dialog.
            //$('body').on('keydown', null, 'shift+p', function () {
            //    if ($(viewer.viewerNodes.$pageList[0]).is(':visible')) {
            //        if ($(viewer.viewerNodes.$overlayFade[0]).is(':visible')) {
            //            if ($(viewer.viewerNodes.$printOverlay[0]).is(':visible')) {
            //                var $printBtn = viewer.$dom.find('[data-pcc-print="submit"]');
            //                $printBtn.click();
            //                return false;
            //            }
            //        }
            //    }
            //    return true;
            //});
        }; //end initKeyBindings

        // Launch E-Signature modal
        this.launchESignModal = function launchESignModal (activeTab) {
            // Load the template, extending the language object with the signatures array
            viewer.viewerNodes.$esignOverlay.html(_.template(options.template.esignOverlay)(_.extend({
                signatures: PCCViewer.Signatures.toArray(),
                activeTab: activeTab,
                categories: (options.signatureCategories) ? options.signatureCategories.split(',') : undefined
            }, PCCViewer.Language.data))).addClass('pcc-open');
            parseIcons(viewer.viewerNodes.$esignOverlay);

            // Show the dark overlay
            viewer.viewerNodes.$overlayFade.show();
        };

        // Launch E-Signature modal in Freehand Mode
        this.launchESignFreehand = function launchESignFreehand () {
            viewer.viewerControl.deselectAllMarks();
            viewer.launchESignModal("freehand");

            // Declare esigniture context
            viewer.esignContext = viewer.eSignature.getFreehandContext(viewer.viewerNodes.$esignOverlay.find('[data-pcc-esign="draw"]').get(0));

            // Make sure the context is resized if the window resizes (this happens often on mobile, actually)
            $(window).on('resize', resizeESignContext);
        };

        // Launch E-Signature modal in Text Mode
        this.launchESignText = function launchESignText () {
            viewer.viewerControl.deselectAllMarks();
            viewer.launchESignModal("text");

            // Declare an custom esignature context
            viewer.esignContext = viewer.eSignature.getTextContext();
        };

        // Launch E-Signature modal in Manage Mode
        this.launchESignManage = function launchESignManage () {
            viewer.launchESignModal("manage");

            // check if there are any signatures
            if (PCCViewer.Signatures.toArray().length) {
                // clear the 'no signatures' message and populate previews
                var $manageView = viewer.viewerNodes.$esignOverlay.find('[data-pcc-esign=manageView]');
                $manageView.html('');
                viewer.eSignature.getManageContext($manageView.get(0));
            }
        };

        // Close the eSign modal and clean up
        this.closeEsignModal = function closeEsignModal () {
            viewer.viewerNodes.$esignOverlay.removeClass('pcc-open');
            viewer.viewerNodes.$overlayFade.hide();
        };

        // Set mouse tool, update current marks and show context menu
        this.setMouseTool = function (opts) {
            opts = opts || {};

            if (!opts.thisButton) {
                // try to find a matching button
                opts.thisButton = viewer.viewerNodes.$mouseTools.filter('[data-pcc-mouse-tool=' + opts.mouseToolName + ']');
            }

            var mouseToolName = opts.mouseToolName,
                $thisButton = $(opts.thisButton),
                forceLock = viewer.stickyToolsAlwaysOn,
                active = $thisButton.hasClass('pcc-active'),
                locked = $thisButton.hasClass('pcc-locked'),
                canLock = !!this.stickyTools[getMouseToolType(mouseToolName)];

            // Exit early if the mouse tool is not actually changing and it is not a lockable tool.
            if (!canLock && (!mouseToolName || this.uiMouseToolName === mouseToolName)) {
                return;
            }

            // make the buttons for this mouse tool active
            var buttons = viewer.$dom.find('[data-pcc-mouse-tool*=' + mouseToolName + ']');
            viewer.$dom.find('[data-pcc-mouse-tool]').not(buttons).removeClass('pcc-active pcc-locked');

            // activate the buttons
            if (forceLock && canLock) {
                // forceLocks come from API calls that do not know the current state of the buttons,
                // the expected hevavior is to activate and lock the tool
                buttons.addClass('pcc-active pcc-locked');
            } else if (active && canLock && !opts.apiTrigger) {
                // if the buttons is already active, then also lock it
                buttons.toggleClass('pcc-locked');
            } else {
                // activate the non-active buttons
                buttons.addClass('pcc-active');
            }

            // set the current mouse tool known to the UI
            this.uiMouseToolName = mouseToolName;

            if (this.uiMouseToolName === 'AccusoftSelectToZoom') {
                viewer.isFitTypeActive = false;
                viewer.viewerNodes.$fitContent.removeClass('pcc-active');
            }

            // set the mouse tool of the ViewerControl
            this.viewerControl.setCurrentMouseTool(mouseToolName);

            // Get template mark for the mouse tool, and update the current marks array
            var mouseTool = PCCViewer.MouseTools.getMouseTool(mouseToolName);

            // populate current marks array
            if (mouseTool && mouseTool.getTemplateMark) {
                this.currentMarks = [mouseTool.getTemplateMark()];
            }
            else {
                this.currentMarks = [];
            }

            // determine if we need to show the context menu for this mouse tool
            var showContextMenu;
            if (buttons.length === 0 || buttons.data('pccContextMenu') === undefined) {
                // If a button for the mouse tool is not found and the data-pcc-context-menu attribute is not found,
                // then default to showing the context menu for the mouse tool. This mouse tool was likely set via
                // the API, outside of any UI elements.
                showContextMenu = true;
            } else {
                // otherwise, use the value of the data-pcc-context-menu attribute to determine whether to show the
                // context menu
                showContextMenu = !!buttons.data('pccContextMenu');
            }

            // update the context menu: this will either hide the context menu, show the context menu, or update
            // the context menu to show the correct controls
            updateContextMenu({
                showContextMenu: showContextMenu,
                showAllEditControls: mouseTool.getType() === PCCViewer.MouseTool.Type.EditMarks,
                mouseToolType: mouseTool.getType()
            });
        };

        this.isMouseToolSticky = function() {
            var mouseTool = getCurrentMouseTool().getName(),
                $buttons = viewer.viewerNodes.$mouseTools.filter('[data-pcc-mouse-tool=' + mouseTool + ']'),
                locked = !!$buttons.filter('.pcc-active.pcc-locked').length;

            return locked;
        };

        this.setMouseToolIfUnlocked = function(mouseToolName) {
            var locked = viewer.isMouseToolSticky();

            if (!locked) {
                var mouseTool = getCurrentMouseTool().getName(),
                    $buttons = viewer.viewerNodes.$mouseTools.filter('[data-pcc-mouse-tool=' + mouseTool + ']');

                viewer.setMouseTool({
                    mouseToolName: 'AccusoftPanAndEdit',
                    thisButton: $buttons.filter('.pcc-active.pcc-locked').get(0)
                });
            }
        };

        // Notification messages that display errors and messages to user
        this.notifyTimer = 0;
        this.notify = function (args) {
            var el = viewer.$dom.find('[data-pcc-notify]');

            if (typeof args.type !== 'undefined') {
                el.attr('data-pcc-notify-type', args.type);
            } else {
                el.attr('data-pcc-notify-type', 'error');
            }

            el.addClass('pcc-open').find('p').text(args.message);

            if (!args.sticky) {
                clearTimeout(viewer.notifyTimer);
                viewer.notifyTimer = setTimeout(function () {
                    el.removeClass('pcc-open');
                }, 3000);
            }
        };

        // Toggle elements on or off using the data-pcc-toggle attribute
        function toggleNodes (ev, tabParent) {
            var $elBeingToggled = {},
                $elContextMenu = viewer.viewerNodes.$contextMenu,
                $target = $(ev.target),
                $currentTarget = $(ev.currentTarget),
                isPreset = false,
                toggleID = $currentTarget.attr('data-pcc-toggle');

            // For tabset hide other tab content
            if (tabParent && $target.parents().hasClass('pcc-tabs')) {
                $target.parents('.pcc-tabs').find('.pcc-active').removeClass('pcc-active');
                tabParent.find('.pcc-tab-content').removeClass('pcc-open');
            }

            if (toggleID === 'dialog-save-annotations') {
                if (!viewer.annotationIo.onOpenDialog('save')) {
                    return;
                }
            } else if (toggleID === 'dialog-load-annotations' || toggleID === 'dialog-load-annotation-layers') {
                if (!viewer.annotationIo.onOpenDialog) {
                    return;
                }

                if (options.annotationsMode === viewer.annotationsModeEnum.LayeredAnnotations) {
                    viewer.annotationIo.onOpenDialog(viewer.annotationIo.modes.loadMarkupLayers, $currentTarget.attr('data-pcc-toggle-mode'));
                } else {
                    viewer.annotationIo.onOpenDialog(viewer.annotationIo.modes.loadClassic);
                }

            } else if (toggleID === 'dialog-annotation-layer-review') {
                viewer.annotationLayerReview.refresh();
            } else if (toggleID === 'dialog-annotation-layer-save') {
                var markupLayer = viewer.viewerControl.getActiveMarkupLayer();
                if (markupLayer.getName() === undefined) {
                    viewer.annotationLayerSave.onOpenDialog(markupLayer);
                }
                else {
                    viewer.annotationLayerSave.onSave(markupLayer);
                    return;
                }
            }

            $elBeingToggled = viewer.$dom.find('[data-pcc-toggle-id="' + toggleID + '"]');
            isPreset = $target.parents().hasClass('pcc-select-search-patterns');

            $('[data-pcc-toggle="' + toggleID + '"]').toggleClass('pcc-active');
            // If it is a dialog
            if ($elBeingToggled.hasClass('pcc-dialog')) {
                toggleDialogs({
                    $elem: $elBeingToggled,
                    $target: $currentTarget,
                    toggleID: toggleID,
                    $contextMenu: $elContextMenu
                });
            } else {
                // Search presets has unique dropdown behavior
                if (isPreset && $elBeingToggled.hasClass('pcc-open')) {
                    if ($target.hasClass('pcc-label') || $target.hasClass('pcc-arrow-down')) {
                        $elBeingToggled.removeClass('pcc-open');
                    }
                } else if (!$currentTarget.hasClass('pcc-disabled')) {
                    $elBeingToggled.toggleClass('pcc-open');
                }
            }

            if (toggleID === 'dropdown-search-fixed-box') {
                ev.stopPropagation();
            }
        }

        // Subset of toggleNodes used for dialogs
        function toggleDialogs(opts) {
            var $elBeingToggled = opts.$elem,
                $currentTarget = opts.$target,
                $elContextMenu = opts.$contextMenu,
                $thumbDialog = viewer.viewerNodes.$thumbnailDialog,
                toggleID = opts.toggleID,
                toggleArgs = {},
                openClass = 'pcc-open',
                secondaryClass = 'pcc-open-as-secondary',
                isOpen = function($el){
                    return $el.hasClass(openClass);
                },
                isThumbnailsOpen = isOpen($thumbDialog),
                isThisOpen = isOpen($elBeingToggled),
                openingThumbs = /thumbnails/.test(toggleID);

            // Check if we are toggling the thumbnails panel, or another panel
            if (viewer.latestBreakpoint === viewer.breakpointEnum.mobile) {
                // On mobile, we want to do a plain toggle, without keeping thumbnails open

                viewer.viewerNodes.$dialogs.not($elBeingToggled).removeClass(openClass + ' ' + secondaryClass);
                // deactivate all active triggers, except thumbnails
                viewer.$dom
                    .find('[data-pcc-toggle*="dialog"].pcc-active')
                    .not('[data-pcc-toggle="' + toggleID + '"]')
                    .removeClass('pcc-active');

                $elBeingToggled.toggleClass(openClass);

            } else if (openingThumbs) {
                var hasExistingOpenPanel = viewer.viewerNodes.$dialogs.is('.' + openClass);

                // We are toggling the thumbnails panel
                if (isThumbnailsOpen) {
                    // thumbnails is open and we need to close it
                    $thumbDialog.removeClass(openClass + ' ' + secondaryClass);
                    toggleArgs.secondaryDialog = 'close';
                } else if (!isThumbnailsOpen && hasExistingOpenPanel) {
                    // there is a panel open, so we need to open thumbnails as secondary
                    $thumbDialog.addClass(openClass + ' ' + secondaryClass);
                    toggleArgs.secondaryDialog = 'open';
                } else {
                    // open thumbnails as normal
                    $thumbDialog.addClass(openClass);
                }
            } else {
                if (isThisOpen) {
                    // close the open panel
                    $thumbDialog.removeClass(secondaryClass);
                    $elBeingToggled.removeClass(openClass);
                    toggleArgs.secondaryDialog = 'close';
                } else {
                    // close all other panels, except thumbnails
                    viewer.viewerNodes.$dialogs.not($thumbDialog).removeClass(openClass);

                    // open the closed panel
                    $elBeingToggled.addClass(openClass);
                    if (isThumbnailsOpen) {
                        $thumbDialog.addClass(secondaryClass);
                        toggleArgs.secondaryDialog = 'open';
                    }
                }

                // deactivate all active triggers, except thumbnails
                viewer.$dom
                    .find('[data-pcc-toggle*="dialog"].pcc-active')
                    .not('[data-pcc-toggle="' + toggleID + '"]')
                    .not('[data-pcc-toggle*="thumbnail"]')
                    .removeClass('pcc-active');
            }

            // Adjust DOM offsets based on open panels
            toggleDialogOffset(toggleArgs);
            if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }

            if (openingThumbs) {
                viewer.thumbnailManager.embedOnce();
            }

            // Nudge the context menu if a dialog is shown
            if (/search/.test(toggleID) && viewer.$dom.find('.pcc-dialog.pcc-open').length && $(window).width() <= viewer.tabBreakPoint) {
                $elContextMenu.addClass('pcc-move');
            } else {
                $elContextMenu.removeClass('pcc-move');
            }

            updateContextMenuDropdownsMaxHeight();
        }

        function openDialog (opts){
            var toggleID = opts.toggleID,
                $dialog = opts.$dialog || viewer.$dom.find('[data-pcc-toggle-id="' + toggleID + '"]'),
                $trigger = opts.$trigger || viewer.$dom.find('[data-pcc-toggle="' + toggleID + '"]'),
                toggleArgs = {},
                $elContextMenu = viewer.viewerNodes.$contextMenu,
                openClass = 'pcc-open',
                secondaryClass = 'pcc-open-as-secondary',
                activeClass = 'pcc-active';

            if ($dialog.hasClass(openClass)) {
                // the panel is already open, so there is nothing to do
                return;
            }

            // Execute these checks after the early exit
            var openingThumbs = /thumbnails/.test(toggleID),
                hasOpenPanel = viewer.viewerNodes.$dialogs.hasClass('pcc-open'),
                onMobileView = viewer.latestBreakpoint === viewer.breakpointEnum.mobile;

            if (((openingThumbs && hasOpenPanel) || viewer.viewerNodes.$thumbnailDialog.hasClass(openClass)) && !onMobileView) {
                // we are opening thumbnails while another dialog is already open,
                // or opening a panel while thumbnails is already open,
                // so we need to make thumbnails a secondary panel
                viewer.viewerNodes.$thumbnailDialog.addClass(secondaryClass);
                toggleArgs.secondaryDialog = 'open';
            }

            if(hasOpenPanel) {
                // we are opening a panel while another panel is open, so we need to close already open ones
                viewer.viewerNodes.$dialogs.not($dialog).not(viewer.viewerNodes.$thumbnailDialog).removeClass(openClass);
                viewer.$dom.find('[data-pcc-toggle*="dialog"].pcc-active').not('[data-pcc-toggle*="thumbnail"]').removeClass(activeClass);
            }

            $dialog.addClass(openClass);
            $trigger.addClass(activeClass);

            // when opening thumbnails, always attempt to embed (it will only execute once in a viewer session)
            if (openingThumbs) {
                viewer.thumbnailManager.embedOnce();
            }

            // Adjust DOM offsets based on open panels
            toggleDialogOffset(toggleArgs);

            // Nudge the context menu if a dialog is shown
            if (/search/.test(toggleID) && viewer.$dom.find('.pcc-dialog.pcc-open').length && $(window).width() <= viewer.tabBreakPoint) {
                $elContextMenu.addClass('pcc-move');
            } else {
                $elContextMenu.removeClass('pcc-move');
            }

            if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
        }

        // Update the context menu, either hide the context menu, show the context menu, or update to show the correct controls
        function updateContextMenu(args) {
            var className = 'pcc-open',
                $contextMenu = viewer.$dom.find('.pcc-context-menu'),
                tmplData = {},
                mark = viewer.currentMarks[0],
                lang = PCCViewer.Language.data,
                windowWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth,
                isSignatureTool = args.mouseToolType && args.mouseToolType === PCCViewer.MouseTool.Type.PlaceSignature;

            // Hide the menu if
            // the markSelectionChanged event is triggered AND there's no current marks OR
            // the edit tool is selected AND there's no current marks OR
            // any of the following tools are selected: transparent rectangle redaction, text selection redaction, select text, magnifier, select to zoom, date signature OR
            // multiple marks are selected
            var selectionChangeAndNoMarks = args.markSelectionChanged && !viewer.viewerControl.getSelectedMarks().length && viewer.viewerControl.getCurrentMouseTool() === 'AccusoftPanAndEdit',
                editToolAndNoMarks = args.mouseToolType && (args.mouseToolType === PCCViewer.MouseTool.Type.EditMarks || args.mouseToolType === PCCViewer.MouseTool.Type.PanAndEdit) && !viewer.viewerControl.getSelectedMarks().length,
                isToolWithoutContext = args.mouseToolType && (args.mouseToolType === PCCViewer.MouseTool.Type.TransparentRectangleRedaction || args.mouseToolType === PCCViewer.MouseTool.Type.SelectText ||
                        args.mouseToolType === PCCViewer.MouseTool.Type.Magnifier || args.mouseToolType === PCCViewer.MouseTool.Type.SelectToZoom || viewer.viewerControl.getCurrentMouseTool() === "AccusoftPlaceDateSignature"),
                multipleMarksSelected = viewer.currentMarks.length > 1 ? true : false,
                isImageStampTool = args.mouseToolType && args.mouseToolType.search(/ImageStampAnnotation|ImageStampRedaction$/g) !== -1,
                isImageStampMenu = (mark && !!mark.getImage) || isImageStampTool,
                $input;

            if (selectionChangeAndNoMarks || editToolAndNoMarks || isToolWithoutContext) {
                args.showContextMenu = false;
            }

            // hide the context menu if it should be hidden
            if (!args.showContextMenu) {
                $contextMenu.removeClass(className);
                return;
            }

            if (mark && (viewer.currentMarks.length || viewer.viewerControl.getSelectedMarks().length)) {

                var menuOptions = {
                    collapseLeftSide: false,
                    showTabArea: false,
                    showMainTab: false,
                    activateMainTab: false,
                    showBorderColorTab: false,
                    showFontTab: false,
                    activateFontTab: false,
                    showLayerTab: false,
                    activateLayerTab: false,
                    showESignTab: false,
                    activateESignTab: false,
                    showLinkTab: false,
                    activateLinkTab: false,
                    showLinkStylesTab: false,
                    showImageTab: false,
                    activateImageTab: false,
                    showTransparentFillColor: false,
                    showTransparentBorderColor: false,
                    enableCustomRedactionReason: false,
                    enableMultipleRedactionReasons: false
                };

                menuOptions.enableCustomRedactionReason = (args.enableCustomRedactionReason) ? args.enableCustomRedactionReason : false;
                menuOptions.enableMultipleRedactionReasons = (options.enableMultipleRedactionReasons) ? options.enableMultipleRedactionReasons : false;

                // collapse menu
                if (multipleMarksSelected) {
                    menuOptions.collapseLeftSide = true;
                } else if (mark.getType() === 'TextSelectionRedaction' && !viewer.redactionReasons.enableRedactionReasonSelection) {
                    menuOptions.collapseLeftSide = true;
                }

                // options for main tab
                if (isSignatureTool || mark.getType().search(/^ImageStampAnnotation|ImageStampRedaction$/) !== -1) {
                    menuOptions.showMainTab = false;
                } else if (mark.getType() === 'TextSelectionRedaction') {
                    menuOptions.showMainTab = !!viewer.redactionReasons.enableRedactionReasonSelection;
                } else if (mark.getType() === 'TextHyperlinkAnnotation') {

                    // Show a minimal interface for template marks
                    if (mark.getPageNumber() === 0) {
                        menuOptions.showMainTab = true;
                        menuOptions.showLinkTab = false;
                        menuOptions.activateLinkTab = false;
                    } else {
                        menuOptions.showMainTab = false;
                        menuOptions.showLinkTab = true;
                        menuOptions.activateLinkTab = true;
                        menuOptions.linkText = mark.getHref();
                        menuOptions.showLinkStylesTab = true;
                    }

                } else if (mark.getType().search(/^TransparentRectangleRedaction$|^TextRedaction$/) === -1) {
                    menuOptions.showMainTab = true;
                }

                if (menuOptions.showMainTab && !multipleMarksSelected) {
                    if (mark.getType().search(/^TransparentRectangleRedaction$|^TextRedaction$|^TextSelectionRedaction$/) === -1) {
                        menuOptions.activateMainTab = true;
                    } else if (mark.getType() === 'TextSelectionRedaction' && viewer.redactionReasons.enableRedactionReasonSelection) {
                        menuOptions.activateMainTab = true;
                    }
                }

                // options for border tab options
                if (mark.getBorderColor && mark.getBorderThickness) {
                    menuOptions.showBorderColorTab = true;
                }

                // options for font tab
                if (mark.getType().search(/^TextAnnotation$|^TextRedaction$|^RectangleRedaction$/) !== -1) {
                    menuOptions.showFontTab = true;
                }

                if (menuOptions.showFontTab && !multipleMarksSelected) {
                    if (mark.getType().search(/^TextRedaction$/) !== -1) {
                        menuOptions.activateFontTab = true;
                    }
                }

                // options for layer tab
                if (args.showAllEditControls && mark.getType() !== 'HighlightAnnotation' &&
                    mark.getType() !== 'TextSelectionRedaction' &&
                    mark.getType() !== 'StrikethroughAnnotation' &&
                    mark.getType() !== 'TextHyperlinkAnnotation') {
                    menuOptions.showLayerTab = true;
                }

                if (menuOptions.showLayerTab && !menuOptions.activateFontTab && !multipleMarksSelected) {
                    if (mark.getType().search(/^TransparentRectangleRedaction|ImageStampAnnotation|ImageStampRedaction$/) !== -1) {
                        menuOptions.activateLayerTab = true;
                    }
                }

                // only offer transparent fill color for marks that actually have a fill area
                if (mark.getType().search(/^EllipseAnnotation|RectangleAnnotation|TextAnnotation$/) !== -1) {
                    menuOptions.showTransparentFillColor = true;
                    menuOptions.showTransparentBorderColor = true;
                }

                // options for esign tab
                if (isSignatureTool) {
                    menuOptions.showESignTab = true;
                }

                if (menuOptions.showESignTab) {
                    if (isSignatureTool) {
                        menuOptions.activateESignTab = true;
                    }
                }

                // options for image tab
                if (isImageStampMenu) {
                    menuOptions.showImageTab = true;
                    menuOptions.activateImageTab = true;
                    menuOptions.activateLayerTab = false;

                    menuOptions.currentImage = viewer.imageStamp.getImageUrl(mark.getImage());
                }

                // Check if any tabs are actually turned on at this point.
                // Note that multiple selected marks will always mean to hide the tab area
                if (!multipleMarksSelected) {
                    _.forEach(menuOptions, function(val, key){
                        //if (val === true && key.match(/show[^tT]+Tab/)){
                        if (val === true && key.match(/show[a-zA-Z]+Tab/)){
                            menuOptions.showTabArea = true;
                        }
                    });
                }

                var tmplRedactionReasons = _.clone(viewer.redactionReasonsExtended);
                if (viewer.redactionReasonsExtended.reasons) {
                    tmplRedactionReasons.reasons = viewer.redactionReasonsExtended.reasons.map(function(reason) {
                        return _.clone(reason);
                    });
                } else {
                    tmplRedactionReasons.reasons = [];
                }
                var customRedactionReason = '';
                if (mark.getReason && !options.enableMultipleRedactionReasons) {
                    if (mark.getReason().length && !redactionReasonMenu.isPreloadedRedactionReason(mark.getReason())) {
                        menuOptions.enableCustomRedactionReason = true;
                        args.enableCustomRedactionReason = true;
                    }

                    if (args.enableCustomRedactionReason) {
                        menuOptions.redactionReasonLabel = PCCViewer.Language.data.redactionReasonFreeform;
                        customRedactionReason = mark.getReason();
                    } else if (mark.getReason().length) {
                        menuOptions.redactionReasonLabel = mark.getReason();
                    } else {
                        menuOptions.redactionReasonLabel = PCCViewer.Language.data.redactionReasonSelect;
                    }
                }
                if (mark.getReasons && options.enableMultipleRedactionReasons) {

                    if(mark.getReasons().length && !redactionReasonMenu.isPreloadedRedactionReason(mark.getReasons())){
                        menuOptions.enableCustomRedactionReason = true;
                        args.enableCustomRedactionReason = true;
                    }

                    var _reasons = mark.getReasons();
                    if (menuOptions.enableCustomRedactionReason) {
                        menuOptions.redactionReasonLabel = PCCViewer.Language.data.redactionReasonFreeform;
                        customRedactionReason = getMultipleRedactionReasonsText(_reasons);
                    } else {
                        if (_reasons.length) {
                            menuOptions.redactionReasonLabel = getMultipleRedactionReasonsText(_reasons);
                        } else {
                            menuOptions.redactionReasonLabel = PCCViewer.Language.data.redactionReasonSelect;
                        }
                    }

                    tmplRedactionReasons.reasons.forEach(function (reason) {
                        if(reason.selectable){
                            reason.checked = _reasons.indexOf(reason.reason) >= 0;
                        }
                    });
                }

                // Define template vars and load context menu template
                tmplData = _.extend({
                    mark: mark,
                    multipleMarksSelected: multipleMarksSelected,
                    showAllEditControls: args.showAllEditControls,
                    showSignaturePreview: isSignatureTool,
                    paragraphAlignTitle: mark.getHorizontalAlignment ? lang['paragraphAlign' + mark.getHorizontalAlignment().charAt(0).toUpperCase() + mark.getHorizontalAlignment().slice(1)] : '',
                    reasons: tmplRedactionReasons,
                    customRedactionReason: customRedactionReason,
                    menuOptions: menuOptions
                }, lang);

                $contextMenu.addClass(className).html(_.template(options.template.contextMenu)(tmplData));

                updateContextMenuDropdownsMaxHeight();
                parseIcons($contextMenu);
                disableContextMenuTabbing();
                removeUIElements($contextMenu);

                if (isSignatureTool) {
                    var dom = $contextMenu.find('[data-pcc-esign-preview]').get(0),
                        mouseTool = viewer.eSignature.mouseTool,
                        signature = mouseTool.getTemplateMark().getSignature();

                    if (signature) {
                        viewer.eSignature.insertSignatureView(signature, dom, function () {
                            viewer.launchESignManage();
                        }, false);
                    }
                }

                if (menuOptions.linkText) {
                    $input = $contextMenu.find('[data-pcc-link-input]');

                    $input.val(menuOptions.linkText);

                    var submitLinkInput = function submitLinkInput(value){
                        hyperlinkMenu.setHref(mark, value);

                        // update the menu in order to update the views
                        updateContextMenu(args);
                    };

                    $input.on('change', function(ev){
                        submitLinkInput($(this).val());
                    }).on('keypress', function(ev){
                        if (ev.which === 13) { // Enter key to submit
                            submitLinkInput($(this).val());
                            $(this).blur();
                            return false;
                        }
                    });
                }

                if (args.enableCustomRedactionReason) {
                    $input = $contextMenu.find('[data-pcc-redaction-reason-input]');
                    var reasonsValue = options.enableMultipleRedactionReasons
                        ? getMultipleRedactionReasonsText(mark.getReasons())
                        : mark.getReason();
                    $input.val(reasonsValue)
                        .on('input', function(ev) {
                            var val = $(this).val();
                            if (viewer.redactionReasons.maxLengthFreeformRedactionReasons && val.length > viewer.redactionReasons.maxLengthFreeformRedactionReasons){
                                viewer.notify({message: PCCViewer.Language.data.redactionReasonFreeforMaxLengthOver});
                                $(this).val(val.substring(0, viewer.redactionReasons.maxLengthFreeformRedactionReasons));
                            }
                            if (options.enableMultipleRedactionReasons) {
                                mark.setReasons([$(this).val()]);
                            } else {
                                mark.setReason($(this).val());
                            }
                        });
                }

                if (menuOptions.currentImage) {
                    var $image = $contextMenu.find('[data-pcc-image-stamp-preview]');

                    $image.click(function() {
                        if (isImageStampMenu && !isImageStampTool) {
                            // this is a change for an existing mark, so switch the image
                            viewer.imageStamp.selectMarkImage(function(newImage){
                                mark.setImage(newImage);
                                updateContextMenu(args);
                            });
                        } else {
                            // this is a change for the image associated with a mouse tool
                            viewer.imageStamp.selectToolImage(function(newImage){
                                // update the menu in order to update the views
                                updateContextMenu(args);
                            });
                        }
                    });
                }

                // On larger viewports expand the context menu options
                if (windowWidth > viewer.tabBreakPoint || args.remainActive) {
                    $contextMenu.find('.pcc-pull-left').addClass(className);
                    $contextMenu.find('[data-pcc-toggle=context-menu-options]').toggleClass('pcc-active');
                }

                // Scroll Dropdown if needed
                if(args.scrollTop){
                    $contextMenu.find('.pcc-dropdown').scrollTop(args.scrollTop);
                }
            }
        }

        // Enable/disable features based on viewer configuration uiElements options
        function setUIElements () {
            var $firstTabItem = viewer.viewerNodes.$navTabs.eq(0).find('.pcc-tab-item'),
                $firstTabPane = $firstTabItem.next('.pcc-tab-pane'),
                $elDialogs = viewer.viewerNodes.$dialogs,
                $elContextMenu = viewer.viewerNodes.$contextMenu,
                leftOffsetClass = 'pcc-vertical-offset-left',
                rightOffsetClass = 'pcc-vertical-offset-right';

            // Check for fullScreenOnInit
            if (options.uiElements && options.uiElements.fullScreenOnInit) {
                viewer.$dom.addClass('pcc-full-screen');
                viewer.viewerNodes.$fullScreen.addClass('pcc-active');
            }


            if (options.lockEditableMarkupLayer === true) {
                // Remove the load editable annotations buttons
                viewer.$dom.find('[data-pcc-lock-editable-layer]').remove();
            }

            // There is a uiElements object in the viewer plugin options
            if (options.uiElements) {
                // hide any configured UI Elements
                removeUIElements();

                // Set nodes again after we've changed tabs
                viewer.viewerNodes.$navTabs = viewer.$dom.find('[data-pcc-nav-tab]');
                $firstTabItem = viewer.viewerNodes.$navTabs.eq(0).find('.pcc-tab-item');

                // If no tabs, adjust pagelist position
                if (!viewer.viewerNodes.$navTabs.length) {
                    viewer.viewerNodes.$pageList.css('top', viewer.viewerNodes.$nav.outerHeight());
                }
            }

            // Activate the first tab item and show it's tab pane.
            $firstTabItem.addClass('pcc-active').next('.pcc-tab-pane').addClass('pcc-open');

            // Offset the page list if the first tab has a vertical menu
            if ($firstTabPane.hasClass('pcc-tab-vertical')) {

                // The default offset is to the left side, if the right side is chosen, add the appropriate offset
                if ($firstTabPane.hasClass('pcc-right')) {
                    $elDialogs.removeClass(leftOffsetClass).addClass(rightOffsetClass);
                    $elContextMenu.removeClass(leftOffsetClass).addClass(rightOffsetClass);
                    viewer.viewerNodes.$pageList.removeClass(leftOffsetClass).addClass(rightOffsetClass);
                } else {
                    $elDialogs.removeClass(rightOffsetClass).addClass(leftOffsetClass);
                    $elContextMenu.removeClass(rightOffsetClass).addClass(leftOffsetClass);
                    viewer.viewerNodes.$pageList.removeClass(rightOffsetClass).addClass(leftOffsetClass);
                }
            }

            // Turn markup layer features on or off
            if (options.annotationsMode === viewer.annotationsModeEnum.LayeredAnnotations) {
                viewer.$dom
                    .find('[data-pcc-toggle="dialog-save-annotations"]')
                    .attr('data-pcc-toggle', 'dialog-annotation-layer-save');

                viewer.$dom
                    .find('[data-pcc-toggle="dialog-load-annotations"]')
                    .attr('data-pcc-toggle', 'dialog-load-annotation-layers');

            }

            // Make the tab menu trigger's content match the first tab.
            viewer.$dom.find('[data-pcc-nav-trigger]').html($firstTabItem.html());

            if (viewer.isFitTypeActive === true) { viewer.viewerNodes.$fitContent.addClass('pcc-active'); }
        }

        function handleComparisonTools() {
            if (typeof options.uiElements !== 'object' || options.uiElements === null) {
                options.uiElements = {};
            }

            if (typeof options.uiElements.comparisonTools !== 'string') {
                options.uiElements.comparisonTools = 'availableifrevisions';
            }

            // If uiElements.comparsonTools is set to notAvailable we do not need to do anything else
            if (options.uiElements.comparisonTools.toLowerCase() !== 'notavailable') {

                // availabeIfRevisions will be the default if not specified in the options.
                var comparisonTools = options.uiElements.comparisonTools.toLowerCase() || 'availableifrevisions';
                // If available or active we will show the icon right away.
                if (comparisonTools === 'available' || comparisonTools === 'active') {
                    viewer.viewerNodes.$revisionToggle.removeClass('pcc-hide');
                }
                // If active we will also show the sidebar right away.
                if (comparisonTools === 'active') {
                    viewer.viewerNodes.$revisionToggle.click();
                }

                var revisionsAvailable = viewer.viewerControl.requestRevisions();

                revisionsAvailable.on('PartialRevisionsAvailable', function(ev) {
                    if (ev.partialRevisions.length > 0) {
                        viewer.viewerNodes.$revisionsContainer.removeClass('pcc-hide');

                        if (comparisonTools === 'availableifrevisions' || comparisonTools === 'activeifrevisions') {
                            viewer.viewerNodes.$revisionToggle.removeClass('pcc-hide');
                        }

                        if (comparisonTools === 'activeifrevisions' &&
                            revisionsAvailable.getRevisions().length === ev.partialRevisions.length) {
                            viewer.viewerNodes.$revisionToggle.click();
                        }

                        viewer.revision.addRevisions(ev.partialRevisions);
                    }
                });

            }
        }

        // Remove UI Elements that were configured to be turned off
        function removeUIElements(root) {
            var $root = (root) ? $(root) : viewer.$dom;

            var legacyKeys = [
                'advancedSearch', 'fullScreenOnInit'
            ];

            // remove any elements that are defined as `false` in uiElements
            _.each(options.uiElements, function(value, key) {
                // ignore legacy keys, as these are not used to disable features,
                // but rather enable them
                if (_.contains(legacyKeys, key)) { return; }

                if (value === false) {
                    $root.find('[data-pcc-removable-id=' + key + ']').remove();
                }
            });
        }

        // Set mouse tool default colors set in template
        function setMouseToolDefaults () {
            _.each(viewer.viewerNodes.$mouseTools,function (el) {
                var color = $(el).data('pccDefaultFillColor'),
                    name = $(el).data('pccMouseTool'),
                    label = $(el).data('pccDefaultLabel'),
                    templateMark = {};

                if (color && PCCViewer.MouseTools.getMouseTool(name)) {
                    templateMark = PCCViewer.MouseTools.getMouseTool(name).getTemplateMark();

                    if (templateMark.setColor) {
                        templateMark.setColor(color);

                    } else if (templateMark.setFillColor) {
                        templateMark.setFillColor(color);
                    }
                }

                if (label && PCCViewer.MouseTools.getMouseTool(name)) {
                    templateMark = PCCViewer.MouseTools.getMouseTool(name).getTemplateMark();

                    if (templateMark.setLabel) {
                        templateMark.setLabel(label);

                    }
                }
            });
        }

        // Disable tabbing to context menu elements when it is hidden -- it is closed by default
        function disableContextMenuTabbing () {
            viewer.$dom.find('.pcc-context-menu').find('a, area, button, input, object, select').attr('tabindex', '-1');
        }

        // Polyfill for placeholder attribute
        function placeholderPolyfill () {
            if (!('placeholder' in document.createElement('input'))){
                _.each(viewer.$dom.find('[placeholder]'), function (el) {
                    var placeholderVal = $(el).attr('placeholder'),
                        placeholderClass = 'pcc-placeholder';

                    $(el)
                        .val(placeholderVal)
                        .addClass(placeholderClass)
                        .on('focus', function (ev) {
                            var $el = $(ev.target);
                            if ($el.val() === placeholderVal) {
                                $el.val('').removeClass(placeholderClass);
                            }
                        })
                        .on('blur', function (ev) {
                            var $el = $(ev.target);
                            if (!$el.val().length) {
                                $el.val(placeholderVal).addClass(placeholderClass);
                            }
                        });
                });
            }
        }

        // Helper method - gets the value of an input that is using a placeholder.
        // This method returns the correct value of the input.
        //
        // This works around an issue in older browsers, where  if no
        // text was entered then the value of the input is the placeholder value.
        function getInputValueNotPlaceholder($inputEl) {
            var placeholderClass = 'pcc-placeholder';
            if ($inputEl.hasClass(placeholderClass)) {
                return '';
            } else {
                return $inputEl.val();
            }
        }

        // Convert RGB string to HEX string
        function rgbToHex (rgb) {
            var rgbHexCode = '';
            // IE8 returns HEX, modern browsers return RGB.
            if (rgb.substring(0, 1) === '#') {
                rgbHexCode = rgb;
            } else {
                rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
                rgbHexCode = '#' +
                    ('0' + Number(rgb[1], 10).toString(16)).slice(-2) +
                    ('0' + Number(rgb[2], 10).toString(16)).slice(-2) +
                    ('0' + Number(rgb[3], 10).toString(16)).slice(-2);
            }
            return rgbHexCode;
        }

        // Gets the type of any mouse tool
        function getMouseToolType(name){
            return PCCViewer.MouseTools.getMouseTool(name).getType();
        }
        // Gets the MouseTool type of the current mouse tool
        function getCurrentMouseToolType(){
            var currentToolName = viewer.viewerControl.getCurrentMouseTool();
            return PCCViewer.MouseTools.getMouseTool(currentToolName).getType();
        }
        // Gets the current mouse tool
        function getCurrentMouseTool(){
            var currentToolName = viewer.viewerControl.getCurrentMouseTool();
            return PCCViewer.MouseTools.getMouseTool(currentToolName);
        }

        // Add class to offset pagelist when vertical dialogs are present
        function toggleDialogOffset (args) {
            args = args || {};

            var $openDialog = viewer.$dom.find('.pcc-dialog.pcc-open'),
                $pageList = viewer.viewerNodes.$pageList,
                isThumbnails = $openDialog.is(viewer.viewerNodes.$thumbnailDialog),
                manualOffset,
                removeManualOffset = function(){
                    // Remove the padding only if it is defined directly on the element. Do not
                    // bother removing it if we are applying a new manual offset, since it will
                    // just be overwritten in one operation.
                    if ($pageList.css('padding-left') && !manualOffset) {
                        $pageList.css('padding-left', '');
                    }
                };

            if (isThumbnails && viewer.latestBreakpoint !== viewer.breakpointEnum.mobile) {
                // Offset based on the right side of the thumbnail list. This takes into account
                // both primary and secondary offsets.
                manualOffset = viewer.viewerNodes.$thumbnailDialog.get(0).getBoundingClientRect().right -
                               viewer.$dom.get(0).getBoundingClientRect().left;
            }

            // Only apply offset if there is an open dialog
            if (viewer.viewerNodes.$dialogs.hasClass('pcc-open')) {
                $pageList.addClass('pcc-dialog-offset');
            } else {
                $pageList.removeClass('pcc-dialog-offset');
                removeManualOffset();
            }

            // Check if two dialogs are open and need to be offset more
            if (args.secondaryDialog === 'open') {
                $pageList.addClass('pcc-dialog-offset-secondary');
            } else if (args.secondaryDialog === 'close' && $pageList.hasClass('pcc-dialog-offset-secondary')) {
                $pageList.removeClass('pcc-dialog-offset-secondary');
                removeManualOffset();
            }

            if (manualOffset) {
                $pageList.css('padding-left', manualOffset + 'px');
            }

            viewer.$events.trigger('pagelistresize');
        }

        // Page list event handlers

        // Estimated page count is available
        function estimatedCountHandler (ev) {
            viewer.pageCount = ev.pageCount;
            viewer.viewerNodes.$pageCount.html(ev.pageCount);
        }

        // Page count is available
        function pageCountHandler (ev) {
            viewer.pageCount = ev.pageCount;
            viewer.viewerNodes.$pageCount.html(ev.pageCount);

            // Show Next/Previous page navigation buttons if multiple pages
            if (ev.pageCount > 1) {
                viewer.viewerNodes.$firstPage.removeClass('pcc-hide');
                viewer.viewerNodes.$lastPage.removeClass('pcc-hide');
                viewer.viewerNodes.$prevPage.addClass('pcc-show-lg');
                viewer.viewerNodes.$nextPage.addClass('pcc-show-lg');
            }

            // Initialize predefined search
            viewer.search.initialSearchHandler();
            // Register event to allow the search module to open the UI
            viewer.search.on('open', function(){
                openDialog({ toggleID: 'dialog-search' });
            });
        }

        // Page failed to load
        // Error Codes:
        // 504 - Document Not Found or Server Error
        // 403 - Session Expired
        function pageLoadFailedHandler (ev) {
            var message = PCCViewer.Language.data.documentNotFound;
            if (ev.statusCode === 504 || ev.statusCode === 403) {
                if (ev.statusCode === 403) {
                    message = PCCViewer.Language.data.sessionExpired;
                }
                viewer.notify({ sticky: true, message: message });
                viewer.viewerNodes.$pageList.hide();
            }
        }

        // Page has changed
        function pageChangedHandler (ev) {
            viewer.viewerNodes.$pageSelect.val(ev.pageNumber);
        }

        // Once a mark has been created
        function markCreatedHandler (ev) {
            // Leave text tool selected so you can enter text, otherwise select edit annotation tool.
            if (ev.mark.getType() !== PCCViewer.Mark.Type.TextAnnotation &&
                ev.mark.getType() !== PCCViewer.Mark.Type.TextRedaction &&
                ev.mark.getType() !== PCCViewer.Mark.Type.TextInputSignature &&
                getCurrentMouseToolType() !== PCCViewer.MouseTool.Type.EditMarks) {

                viewer.setMouseToolIfUnlocked('AccusoftPanAndEdit');
            }

            // find out if the current mouse tool is "sticky"
            var locked = viewer.isMouseToolSticky();

            // if not, hide the context menu so users don't get confused and try to use it to change font settings
            if (!locked) {
                viewer.viewerNodes.$contextMenu.removeClass('pcc-open');
            }
        }

        // Mark has changed
        function markChangedHandler (ev) {
            var markType = ev.mark.getType();

            // Once text is entered into the text tool and click outside, select edit annotation tool.
            if ((markType === PCCViewer.Mark.Type.TextAnnotation ||
                markType === PCCViewer.Mark.Type.TextRedaction ||
                markType === PCCViewer.Mark.Type.TextInputSignature) &&
                getCurrentMouseToolType() !== PCCViewer.MouseTool.Type.EditMarks) {
                viewer.setMouseToolIfUnlocked('AccusoftPanAndEdit');
            } else if (markType === PCCViewer.Mark.Type.FreehandSignature || markType === PCCViewer.Mark.Type.TextSignature) {
                // Keep track of the size that the user has used for the signature
                viewer.eSignature.updateSignatureSizeOnDocument(ev.mark);
            }
        }

        // Mark selection has changed
        function markSelectionChangedHandler () {
            if (getCurrentMouseTool().getName() !== 'AccusoftPanAndEdit'){
                return;
            }
            var marks = viewer.viewerControl.getSelectedMarks();

            // Update current marks array
            viewer.currentMarks = marks;
            // Show context menu
            updateContextMenu({
                showContextMenu: true,
                showAllEditControls: true,
                markSelectionChanged: true
            });

        }

        // Document has text promise is resolved
        function documentHasTextResolved (hasText) {
            if (hasText) {
                viewer.documentHasText = true;

                if (fileDownloadManager.isInPreviewMode() !== true) {
                    // Enable text selection tools
                    viewer.viewerNodes.$selectText.removeClass('pcc-disabled');
                    viewer.viewerNodes.$highlightAnnotation.removeClass('pcc-disabled');
                    viewer.viewerNodes.$strikethroughAnnotation.removeClass('pcc-disabled');
                    viewer.viewerNodes.$hyperlinkAnnotation.removeClass('pcc-disabled');
                    viewer.viewerNodes.$textSelectionRedaction.removeClass('pcc-disabled');
                }
            }
        }

        // Page text is ready
        function pageTextReadyHandler (ev) {
            viewer.search.pageTextReadyHandler(ev);
        }

        // Scaling of page(s) in the viewer has changed
        function scaleChangedHandler (ev) {
            var disabledClass = 'pcc-disabled';

            viewer.viewerNodes.$zoomLevel.html(Math.round(ev.scaleFactor * 100) + '%');

            if (ev.fitType !== PCCViewer.FitType.FullWidth && ev.fitType !== PCCViewer.FitType.FullHeight && ev.fitType !== PCCViewer.FitType.FullPage && ev.fitType !== PCCViewer.FitType.ActualSize) {
                viewer.isFitTypeActive = false;
                viewer.viewerNodes.$fitContent.removeClass('pcc-active');
            } else {
                viewer.currentFitType = ev.fitType;
                viewer.isFitTypeActive = true;
                viewer.viewerNodes.$fitContent.addClass('pcc-active');
            }

            // If the viewer is at or beyond the maximum scale, and cannot be zoomed in any further, disable the Zoom In Tool
            if (viewer.viewerControl.getAtMaxScale()) {
                viewer.viewerNodes.$zoomIn.addClass(disabledClass);
            // Otherwise show the Zoom In Tool
            } else {
                if (viewer.viewerNodes.$zoomIn.hasClass(disabledClass)) {
                    viewer.viewerNodes.$zoomIn.removeClass(disabledClass);
                }
            }

            // If the viewer is at or beyond the minimum scale, and cannot be zoomed out any further, disable the Zoom Out Tool
            if (viewer.viewerControl.getAtMinScale()){
                viewer.viewerNodes.$zoomOut.addClass(disabledClass);
            // Otherwise show the Zoom Out Tool
            } else {
                if (viewer.viewerNodes.$zoomOut.hasClass(disabledClass)) {
                    viewer.viewerNodes.$zoomOut.removeClass(disabledClass);
                }
            }
        }

        // Viewer Ready event handler
        function viewerReadyHandler () {
            viewer.viewerReady = true;
            // pre-load signature fonts
            fontLoader.preLoad();
            commentUIManager.init({
                viewerControl: viewer.viewerControl,
                template: options.template.comment,
                language: PCCViewer.Language.data,
                commentDateFormat: options.commentDateFormat,
                button: viewer.viewerNodes.$commentsPanel,
                panel: viewer.$dom.find('.pccPageListComments'),
                mode: options.commentsPanelMode || 'auto',
                pageList: viewer.viewerNodes.$pageList
            });

            handleComparisonTools();

            viewer.$events.on('pagelistresize', function(ev, params){
                commentUIManager.updatePanel(params);
            });
            viewer.viewerNodes.$zoomLevel.html(Math.round(viewer.viewerControl.getScaleFactor() * 100) + '%');
        }

        // Viewing Session Changing handler
        function viewingSessionChangingHandler() {
            // Cancel current search to stop requesting server
            viewer.search.cancelAndClearSearchResults();
        }

        // Viewing Session Changed handler
        function viewingSessionChangedHandler() {
            viewer.viewerNodes.$pageSelect.val(viewer.viewerControl.pageNumber);

            // reset current mouse tool to the Pan tool
            viewer.viewerControl.setCurrentMouseTool('AccusoftPanAndEdit');
            viewer.viewerNodes.$panTool.click();

            if (viewer.viewerControl.redactionViewMode === PCCViewer.RedactionViewMode.Draft) {
              viewer.viewerNodes.$redactionViewMode.addClass('pcc-active');
            } else {
              viewer.viewerNodes.$redactionViewMode.removeClass('pcc-active');
            }

            viewer.imageStamp.refresh();
            viewer.eSignature.refresh();
            commentUIManager.refresh();
            viewer.imageToolsDropdownUI.refresh();
            viewer.search.refresh();
            viewer.annotationIo.refresh();
            viewer.annotationLayerReview.refresh();
            fileDownloadManager.refresh();

            scaleChangedHandler({
                scaleFactor: viewer.viewerControl.scaleFactor,
                fitType: viewer.isFitTypeActive ? viewer.currentFitType : null
            });
        }

        // MS Edge does not repaint certain elements properly whenever they change so
        // we are simply forcing the browser to repaint the element by hiding and showing it.
        // TODO: Follow up to see if in a future release of MS Edge we no longer need this code
        function edgeForceRepaintWorkaround(elem){
            var isEdge = !!navigator.userAgent.match('Edge');
            if (!isEdge) {
                return;
            }
            var originalDisplay = $(elem).get(0).style.display;
            setTimeout(function(){
                $(elem).hide().show(0, function(){
                    $(elem).css('display', originalDisplay);
                });
            }, 5);
        }

        // Create the page list
        this.createPageList = function () {
            try {
                // Use the whole options object here.
                this.viewerControl = new PCCViewer.ViewerControl(viewer.viewerNodes.$pageList.get(0), viewer.viewerControlOptions);
            }
            catch (ex) {
                viewer.notify({ sticky: true, message: ex.message });
                viewer.viewerNodes.$pageList.hide();
                return;
            }

            // Attach the PageCountReady and estimated count ready events that would trigger further page adds
            this.viewerControl.on(PCCViewer.EventType.EstimatedPageCountReady, estimatedCountHandler);
            this.viewerControl.on(PCCViewer.EventType.PageCountReady, pageCountHandler);
            this.viewerControl.on(PCCViewer.EventType.PageLoadFailed, pageLoadFailedHandler);
            this.viewerControl.on(PCCViewer.EventType.PageChanged, pageChangedHandler);
            this.viewerControl.on(PCCViewer.EventType.MarkCreated, markCreatedHandler);
            this.viewerControl.on(PCCViewer.EventType.MarkChanged, markChangedHandler);
            this.viewerControl.on(PCCViewer.EventType.MarkSelectionChanged, markSelectionChangedHandler);
            this.viewerControl.on(PCCViewer.EventType.ScaleChanged, scaleChangedHandler);
            this.viewerControl.on(PCCViewer.EventType.ViewerReady, viewerReadyHandler);
            this.viewerControl.on(PCCViewer.EventType.PageTextReady, pageTextReadyHandler);
            this.viewerControl.on(PCCViewer.EventType.ViewingSessionChanging, viewingSessionChangingHandler);
            this.viewerControl.on(PCCViewer.EventType.ViewingSessionChanged, viewingSessionChangedHandler);
            this.viewerControl.documentHasText().then(documentHasTextResolved);

            // Initialize the download options menu
            if (!(options.uiElements && options.uiElements.download === false)) {
                fileDownloadManager.init(this.viewerControl, options.template.downloadOverlay, PCCViewer.Language.data);
            }

            // Initialize the attachments manager
            if (options.uiElements && (options.uiElements.attachments === undefined || options.uiElements.attachments)) {
                attachmentManager.init(this.viewerControl, PCCViewer.Language.data);
            }

            // Initialize immediate action menu
            if (options.immediateActionMenuMode && options.immediateActionMenuMode.toLowerCase() !== "off") {
                immediateActionMenu.init({
                    viewerControl: this.viewerControl,
                    $overlay: viewer.viewerNodes.$overlay,
                    $overlayFade: viewer.viewerNodes.$overlayFade,
                    copyOverlay: options.template.copyOverlay,
                    mode: options.immediateActionMenuMode,
                    actions: this.immediateActionMenuActions,
                    languageOptions: PCCViewer.Language.data,
                    redactionReasons: viewer.redactionReasonsExtended,
                    redactionReasonMenuTrigger: redactionReasonMenu.triggerMenu
                });
            }

            // Initialize the hyperlink menu
            hyperlinkMenu.init(this.viewerControl, PCCViewer.Language.data, options.template.hyperlinkMenu, getCurrentMouseToolType);

            // Initialize the redaction reason menu
            redactionReasonMenu.init(this.viewerControl, PCCViewer.Language.data, options.template.redactionReason, viewer.redactionReasons.reasons, viewer.redactionReasons.maxLengthFreeformRedactionReasons);

            // Initialize the thumbnail view
            viewer.thumbnailManager.init({
                viewerControl: this.viewerControl,
                container: viewer.viewerNodes.$thumbnailDialog,
                viewer: viewer.$dom,
                dom: viewer.viewerNodes.$thumbnailList
            });
            viewer.thumbnailManager.on('resize', function(ev, params){
                // Perform an offset on the PageList and fit if necessary
                toggleDialogOffset();
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });
            viewer.thumbnailManager.on('reset', function(ev){
                // remove the manual offset on the PageList and fit if necessary
                viewer.viewerNodes.$pageList.css('padding-left', '');
                if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
            });

            // Bind events to restore search highlights after text selection based mark created
            viewer.search.bindRestoringSearchHighlight();
        };

        // Destroy the viewer control
        this.destroy = function () {
            if (viewer.viewerControl) {
                viewer.viewerControl.destroy();
                delete viewer.viewerControl;
            }

            viewer.$dom.removeClass('pccv pcc-full-screen');
            viewer.$dom.removeData(DATAKEY);
            viewer.$dom.empty();

            // detach window resize callbacks
            _.each(windowResizeCallbacks, function(windowResizeCallback) {
                $(window).off('resize', windowResizeCallback);
            });

            windowResizeCallbacks = [];
        };

        //Generic object for making result views for search and revisions
        var genericView = {
            elem: function(type, opts){
                opts = opts || {};
                var elem = document.createElement(type || 'div');
                if (typeof opts.className === 'string') {
                    elem.className = opts.className;
                }
                if (typeof opts.text !== 'undefined') {
                    // Sanitize the text being inserted into the DOM
                    elem.appendChild( document.createTextNode(opts.text.toString()) );
                }
                return elem;
            },
            pageNumber: function(number){
                return genericView.elem('div', { className: 'pcc-col-2 pcc-center', text: number });
            }
        };



        this.revision = (function() {
            // The revision module implements the UI control and API necessary
            // to implement the viewer's document comparision functionality. Module members that
            // are prefixed with private are only accessible with the module's scope while 'public'
            // means it can be access outside the module's scope

            // Current number of revisions
            var revisionsCount = 0,

            // An array of revision results
            revisions = [],

            // Current active revision ID
            activeRevisionId,

            // Number of revisions to show at a time,
            revisionsPageLength = !isNaN(options.revisionsPageLength) && options.revisionsPageLength > 0 ? options.revisionsPageLength : 250,

            // Use jQuery events to subscribe and trigger events internal to revision
            $event = $({}),

            // Toggleable elements
            $revisionContainerToggles = viewer.$dom.find('[data-pcc-revision-container-toggle]'),
            $revisionContainers = viewer.$dom.find('[data-pcc-revision-container]'),

            // Fragment containing all sorted revisions, only a subset of these results are ever added to the DOM
            allRevisionsFragment = document.createDocumentFragment(),
            currentRevisionPageStartIndex = 0,
            activeRevisionPageStartIndex;

            var revisionView = _.clone(genericView);

            // This method creates and returns DOM for the revision item
            revisionView.revisionBuild = function(revision){
                var revisionItem,
                    revisionType,
                    // get the lowercase version of the revision type so we can use it as a key for reference
                    revisionTypeKey = revision.type.charAt(0).toLowerCase() + revision.type.slice(1),
                    icon,
                    revisionId = revision.id,
                    revisionTypeIcons = {
                        'contentInserted': 'pencil-add',
                        'contentDeleted': 'pencil-subtract',
                        'propertyChanged': 'pencil',
                        'paragraphNumberChanged': 'pencil',
                        'fieldDisplayChanges': 'pencil',
                        'revisionMarkedAsReconciledConflict': 'pencil',
                        'revisionMarkedAsConflict': 'pencil',
                        'styleChanged': 'pencil',
                        'contentReplaced': 'pencil',
                        'paragraphPropertyChanged': 'pencil',
                        'tablePropertyChanged': 'pencil',
                        'sectionPropertyChanged': 'pencil',
                        'styleDefinitionChanged': 'pencil',
                        'contentMovedFrom': 'pencil',
                        'contentMovedTo': 'pencil',
                        'tableCellInserted': 'pencil-add',
                        'tableCellDeleted': 'pencil-subtract',
                        'tableCellsMerged': 'pencil',
                        'unknown': 'unknown'
                    };

                icon = revisionTypeIcons[revisionTypeKey];
                revisionType = PCCViewer.Language.data.revisionTypes[revisionTypeKey];
                revisionItem = revisionView.elem('div', { className: 'pcc-row' });

                revisionItem.setAttribute('data-pcc-revision-id', revisionId);
                revisionItem.appendChild(revisionView.pageNumber(revision.getEndPageNumber()));
                revisionItem.appendChild(revisionView.elem('div', {className: 'pcc-col-8', text: revisionType}));
                revisionItem.appendChild(revisionView.typeIcon(icon));
                parseIcons($(revisionItem));

                $(revisionItem).on('click', function (ev) {
                    $event.trigger('selectRevision', {
                        type: 'revision',
                        result: revision,
                        node: this
                    });

                    viewer.viewerControl.setPageNumber(revision.getEndPageNumber());
                });

                allRevisionsFragment.appendChild(revisionItem);
                return revisionItem;
            };

            revisionView.typeIcon = function(icon){
                return genericView.elem('div', { className: 'pcc-icon pcc-icon-' + icon });
            };

            $revisionContainerToggles.on('click', function(ev){
                var $this = $(this),
                    which = $this.data('pcc-revision-container-toggle'),
                    wasActive = $this.hasClass('pcc-active'),
                    hideAllClass = 'pcc-hide pcc-hide-lg';

                if (wasActive) {
                    // turn off this toggle
                    $this.removeClass('pcc-active');

                    viewer.viewerNodes.$revisionDialog.removeClass('pcc-expand');
                } else {
                    // turn on this toggle
                    $revisionContainerToggles.removeClass('pcc-active');
                    $this.addClass('pcc-active');

                    viewer.viewerNodes.$revisionDialog.addClass('pcc-expand');
                }

                // toggle was flipped, so flip the bool
                var isActive = !wasActive;

                if (isActive) {

                    // Hide all containers
                    $revisionContainers.addClass(hideAllClass);

                    // Show current container
                    $revisionContainers.filter('[data-pcc-revision-container="' + which + '"]').removeClass(hideAllClass);


                } else {

                    // Hide current container
                    $revisionContainers.filter('[data-pcc-revision-container="' + which + '"]').addClass(hideAllClass);
                }
            });

            viewer.viewerNodes.$revisionPrevPage.on('click', function (ev) {
                ev.preventDefault();
                showRevisionSubset(currentRevisionPageStartIndex - revisionsPageLength);
            });
            viewer.viewerNodes.$revisionNextPage.on('click', function (ev) {
                ev.preventDefault();
                showRevisionSubset(currentRevisionPageStartIndex + revisionsPageLength);
            });

            $event.on('selectRevision', function(ev, data){
                // set the active revision node
                var $activeRevision = $(data.node);
                activeRevisionId = data.result.id;

                activeRevisionPageStartIndex = currentRevisionPageStartIndex;

                // deselect a previously selected result in the revision UI
                viewer.viewerNodes.$revisions.find('.pcc-row.pcc-active').removeClass('pcc-active');

                // select the new result
                $activeRevision.addClass('pcc-active');

                // deselect any comment that may have been selected from a previous result
                $event.trigger('deselectPreviousRevision');

                // update revision UI to reflect selection
                updateRevisionPrevNextButtons();
                updateRevisionCountText();

                // collapse the expanded panel
                viewer.viewerNodes.$revisionDialog.removeClass('pcc-expand')
                      // switch the active results button to off state
                      .find('[data-pcc-revision-container-toggle="results"]').removeClass('pcc-active');
            });

            // Selecting the Next button in the revision result list causes the following revisions to be selected and
            // displayed.
            var nextRevisionClickHandler = function (nextResultBtn) {
                if (revisionsCount === 0 || $(nextResultBtn).attr('disabled')) {
                    return false;
                }

                var results = viewer.viewerNodes.$revisions;
                var $activeRevision;

                if (activeRevisionId === undefined) {
                    $activeRevision = results.children(":first");
                    $activeRevision.click();
                } else {
                    if (activeRevisionPageStartIndex !== currentRevisionPageStartIndex) {
                        // Navigate to the page containing the active search result.
                        showRevisionSubset(activeRevisionPageStartIndex);
                    }

                    $activeRevision = results.find("[data-pcc-revision-id='" + activeRevisionId + "']").next();

                    if ($activeRevision.length) {
                        activeRevisionId = $activeRevision.attr('data-pcc-revision-id');
                        $activeRevision.click();
                        results.scrollTop(results.scrollTop() + $activeRevision.position().top - 200);
                    }
                    else {
                        showRevisionSubset(currentRevisionPageStartIndex + revisionsPageLength);
                        $activeRevision = $(results.children()[0]);
                        activeRevisionId = $activeRevision.attr('data-pcc-revision-id');
                        $activeRevision.click();
                    }
                }
            };

            // Selecting the Previous button in the revision list causes the previous revision to be selected and
            // displayed.
            var previousRevisionClickHandler = function (previousResultBtn) {
                if (revisionsCount === 0 || $(previousResultBtn).attr('disabled')) {
                    return false;
                }

                var revisions = viewer.viewerNodes.$revisions;
                var $activeRevision;

                if (activeRevisionId === undefined) {
                    $activeRevision = revisions.children(":last");
                    $activeRevision.click();
                } else {
                    if (activeRevisionPageStartIndex !== currentRevisionPageStartIndex) {
                        // Navigate to the page containing the active search result.
                        showRevisionSubset(activeRevisionPageStartIndex);
                    }

                    $activeRevision = revisions.find("[data-pcc-revision-id='" + activeRevisionId + "']").prev();

                    if ($activeRevision.length) {
                        activeRevisionId = $activeRevision.attr('data-pcc-revision-id');
                        $activeRevision.click();
                        revisions.scrollTop(revisions.scrollTop() + $activeRevision.position().top - 200);
                    }
                    else {
                        showRevisionSubset(currentRevisionPageStartIndex - revisionsPageLength);
                        revisions.scrollTop(revisions.prop('scrollHeight'));
                        $activeRevision = $(revisions.children()[revisionsPageLength - 1]);
                        activeRevisionId = $activeRevision.attr('data-pcc-revision-id');
                        $activeRevision.click();
                    }
                }
            };

            // This function manages the state of the Previous and Next navigation buttons in the revision list.
            var updateRevisionPrevNextButtons = function () {
                var hasNextResult = activeRevisionId < revisionsCount - 1;
                var hasPrevResult = activeRevisionId > 0;
                if (hasNextResult) {
                    viewer.viewerNodes.$revisionNextItem.removeAttr('disabled');
                }
                else {
                    viewer.viewerNodes.$revisionNextItem.attr('disabled', 'disabled');
                }

                if (hasPrevResult) {
                    viewer.viewerNodes.$revisionPrevItem.removeAttr('disabled');
                }
                else {
                    viewer.viewerNodes.$revisionPrevItem.attr('disabled', 'disabled');
                }
            };

            // Updates the text to display revisions count and currently selected revision index
            var updateRevisionCountText = function() {
                if (activeRevisionId !== undefined) {
                    var index = activeRevisionId + 1;
                    viewer.viewerNodes.$revisionCount.html(PCCViewer.Language.data.change + index + ' / ' + revisionsCount);
                } else {
                    var revisionsVerbiage = (revisionsCount === 1) ? PCCViewer.Language.data.changeFound : PCCViewer.Language.data.changesFound;
                    viewer.viewerNodes.$revisionCount.html(revisionsCount + ' ' + revisionsVerbiage);
                }
            }

            // This method re-creates revisions list to display revisions from startIndex
            // to the last available revision, but no more than revisionsPageLength revisions.
            var showRevisionSubset = function (startIndex) {
                var indexChanged = (startIndex !== currentRevisionPageStartIndex);
                currentRevisionPageStartIndex = startIndex;

                if (currentRevisionPageStartIndex > 0) {
                    viewer.viewerNodes.$revisionPrevPage.removeAttr('disabled');
                }
                else {
                    viewer.viewerNodes.$revisionPrevPage.attr('disabled', 'disabled');
                }

                var allRevisionChildren = allRevisionsFragment.childNodes;
                var endIndex;
                if (revisionsCount > currentRevisionPageStartIndex + revisionsPageLength) {
                    viewer.viewerNodes.$revisionNextPage.removeAttr('disabled');
                    endIndex = currentRevisionPageStartIndex + revisionsPageLength;
                }
                else {
                    viewer.viewerNodes.$revisionNextPage.attr('disabled', 'disabled');
                    endIndex = revisionsCount;
                }

                if (indexChanged || viewer.viewerNodes.$revisions.children().length < revisionsPageLength) {
                    var scrollTop = viewer.viewerNodes.$revisions.scrollTop();
                    var subsetFragment = document.createDocumentFragment();

                    // Clone the revisions that should be showing currently.
                    for (var i = currentRevisionPageStartIndex; i < endIndex; i++) {
                        var subsetRevisions = $(allRevisionChildren[i]).clone(true);
                        subsetFragment.appendChild(subsetRevisions[0]);
                    }

                    viewer.viewerNodes.$revisions.empty();
                    viewer.viewerNodes.$revisions.append(subsetFragment);
                    viewer.viewerNodes.$revisions.scrollTop(0);

                    viewer.viewerNodes.$revisions.find('.pcc-row:even').removeClass('pcc-odd');
                    viewer.viewerNodes.$revisions.find('.pcc-row:odd').addClass('pcc-odd');

                    if (activeRevisionId !== undefined) {
                        var $activeRevision = viewer.viewerNodes.$revisions.find("[data-pcc-revision-id='" + activeRevisionId + "']");
                        if ($activeRevision.length) {
                            $activeRevision.addClass('pcc-active');
                            viewer.viewerNodes.$revisions.scrollTop(scrollTop);
                        }
                        if (allRevisionsFragment.childNodes.length > activeRevisionPageStartIndex + revisionsPageLength && activeRevisionPageStartIndex > 0) {
                            updateRevisionPrevNextButtons();
                        }
                    }
                }

                updateRevisionCountText();
            };

            // Adds new revisions chunk to the revisions panel.
            function addRevisions(results) {
                results.forEach(function(result) {
                    revisionView.revisionBuild(result);
                });
                revisionsCount += results.length;

                showRevisionSubset(currentRevisionPageStartIndex);
            }

            // The publicly accessible methods for the revision module
            return {
                addRevisions: addRevisions,
                nextRevisionClickHandler: nextRevisionClickHandler,
                previousRevisionClickHandler: previousRevisionClickHandler
            };
        })();

        // The search module implements the UI control and API access necessary
        // to implement the viewer's document text search functionality. Module members that
        // are prefixed with 'private' are only accessible with the module's scope while 'public'
        // means it can be accessed outside the module's scope.
        this.search = (function () {

            // The search request object returned from the API.
            var searchRequest = {},

            // The number of search hits currently known to the viewer.
                searchResultsCount = 0,

            // An array containing the current search results.
                searchResults = [],

            // Number of results to show at a time,
                resultsPageLength = !isNaN(options.searchResultsPageLength) && options.searchResultsPageLength > 0 ? options.searchResultsPageLength : 250,

            // The search result currently selected by the user.
                activeSearchResultId,

            // The index of the search result selected by the user, which will be restored when running search again.
                activeSearchResultRestoreId,

            // An array containing search items loaded from predefinedSearch.json.
                presetSearchTerms = [],

            // An array containing fixed search items loaded from predefinedSearch.json.
                presetFixedSearchTerms = [],

            // This is a container object that maps search terms (as keys) to search option objects (as values).
                previousSearches = {},

            // A simple search uses a basic text query versus a more advanced regular expression.
                privateSimpleSearch = true,

            // Find the advanced search toggle button and panel
            // We will toggle these to off mode when search is executed
                $advancedSearchToggle = viewer.$dom.find('[data-pcc-toggle=advanced-options]'),
                $advancedSearchPanel = viewer.$dom.find('[data-pcc-toggle-id="advanced-options"]'),
                $searchContainerToggles = viewer.$dom.find('[data-pcc-search-container-toggle]'),
                $searchContainers = viewer.$dom.find('[data-pcc-search-container]'),
                $searchFilterSections = viewer.$dom.find('[data-pcc-search-container=filter] [data-pcc-section]'),

            // Find advanced search type column elements
                $advancedSearchColumnHeader = viewer.$dom.find('.pcc-row-results-header').children(),
            // A search query object to store all processed search terms
                globalSearchTerms = {},

            // A search query object to store all processed fixed search terms
                globalFixedSearchTerms = {},

            // A search query object to store all processed unfixed search terms
                globalUnfixedSearchTerms = {},

            // Save the previous search query to reuse if needed
                prevSearchQuery = {},
            // Save the previous matching options
                prevMatchingOptions = {},

            // Use jQuery events to subscribe and trigger events internal to search
                $event = $({}),

            // A function that is executed whenever the filter UI is dismissed.
            // This is used to apply the selected filters.
                onFilterDismissFunction,

            // A collection of search results and corresponding DOM objects that need to be resorted
            // when the page text is available for the page of the search result.
                searchResultsToResort = [],

            // Track whether or not we are searching the document text. This is used to improve search result display
            // for highlights.
                searchingInDocument = false,

            // Check if advanced search is on. The default is off
                advancedSearchIsOn = false,

                redactionMarks = [],

            // Fragment containing all sorted search results, only a subset of these results are ever added to the DOM
                allResultsFragment = document.createDocumentFragment(),
                currentResultPageStartIndex = 0,
                activeResultPageStartIndex;

            function resetQuickActionMenu() {

                var checkedTerms = viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-checked');

                viewer.viewerNodes.$searchQuickActions.removeClass('pcc-hide');
                viewer.viewerNodes.$searchQuickActionRedactOptions.addClass('pcc-hide');
                viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-section-title').html(PCCViewer.Language.data.searchQuickActions.searchTerms);

                var searchTerms = viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-quick-action-search-term');

                if ( checkedTerms.length === 0 || !searchRequest.getIsComplete || !searchRequest.getIsComplete() || !searchResultsCount) {
                    viewer.viewerNodes.$searchQuickActionRedact.attr('disabled', true);
                }
                else if (checkedTerms.length < searchTerms.length) {
                    viewer.viewerNodes.$searchQuickActionRedact.removeAttr('disabled');
                    viewer.viewerNodes.$searchRedact.html(PCCViewer.Language.data.searchQuickActions.redactSelected);
                } else {
                    viewer.viewerNodes.$searchQuickActionRedact.removeAttr('disabled');
                    viewer.viewerNodes.$searchRedact.html(PCCViewer.Language.data.searchQuickActions.redactAll);
                }

                if (!searchTerms.length || !searchResultsCount) {
                    // clear the quick action terms list
                    viewer.viewerNodes.$searchQuickActionsContainer
                        .find('[data-pcc-section=quickActionSearchTerms] .pcc-section-content').empty()
                        .append( document.createTextNode(PCCViewer.Language.data.searchFilters.noTerms) );
                }

            }

            function resetFilterTermsList() {
                viewer.viewerNodes.$searchFilterContainer
                    .find('[data-pcc-section=searchTerms] .pcc-section-content').empty()
                    .append( document.createTextNode(PCCViewer.Language.data.searchFilters.noTerms) );
            }

            var getMarksHashMap = function(markType) {

                var markMap = {},
                    textSelectionRedactionMarks;

                textSelectionRedactionMarks = viewer.viewerControl.getMarksByType(markType);

                _.each(textSelectionRedactionMarks, function(mark) {

                    var position, hash;

                    position = mark.getPosition();

                    hash = 'T' + markType + 'P' + mark.getPageNumber() + 'I' + position.startIndex + 'L' + position.length;

                    if (typeof markMap[hash] === 'undefined') {
                        markMap[hash] = [mark];
                    } else {
                        markMap[hash].push(mark);
                    }

                });

                return markMap;
            };

            function bindQuickActionDOM() {

                // The quick action menu is about to be displayed so clean up the display from previous uses
                viewer.viewerNodes.$searchQuickActionsToggle.on('click', function() {

                    if (!$(this).hasClass('pcc-active')) {
                        return;
                    }

                    resetQuickActionMenu();

                });

                // Show and hide quick action sections when the titles are clicked on
                viewer.viewerNodes.$searchQuickActionsContainer.on('click', '.pcc-section-title', function(){
                    var $section = $(this).parent('.pcc-section');
                    $section.toggleClass('pcc-expand');
                });

                // When the redact button is clicked, create the redaction marks at the same position of the user selected
                // search terms. Also enable the user to choose a reason if desired.
                viewer.viewerNodes.$searchQuickActionRedact.on('click', function() {

                    var textSelectionRedactionMarks, checkedTerms, searchTerms, replacedMarks = [];

                    // Get map describing position of existing text selection redaction marks
                    textSelectionRedactionMarks = getMarksHashMap(PCCViewer.Mark.Type.TextSelectionRedaction);

                    // get selected terms from the UI
                    checkedTerms = viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-checked').parents('.pcc-search-quick-action');

                    // Temporarily hide the search terms that were not selected. This leaves only the working set of search
                    // terms that will be redacted.
                    viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-quick-action-term [data-pcc-checkbox]:not(.pcc-checked)').parents('.pcc-search-quick-action').hide();

                    // Since we are no longer working with all the search terms but rather a subset, change the section
                    // title accordingly.
                    viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-section-title').html(PCCViewer.Language.data.searchQuickActions.selectionList);

                    // Reset redaction dropdown
                    viewer.viewerNodes.$searchQuickActionRedactionDropdown.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked').removeClass('pcc-checked');
                    viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(PCCViewer.Language.data.searchQuickActions.redactionReasonDropdownSelect);
                    viewer.viewerNodes.$searchQuickActionRedactionInput.addClass('pcc-hide').val('');

                    //Show the processing icon and text
                    viewer.viewerNodes.$searchQuickActions.find('.pcc-redaction-processing').show();

                    // Get the search term strings
                    searchTerms = _.map(checkedTerms, function(el){
                        return el.getAttribute('data-pcc-quick-action-term');
                    });

                    // Loop through the search results, find ones that match the selected search results, and then
                    // redact the document.
                    var redactionTasks = _.chain(searchResults).filter(function (result) {
                        return result instanceof PCCViewer.SearchResult && _.includes(searchTerms, result.getSearchTerm().searchTerm);
                    }).reduce(function (memo, result) {
                        var pageNum = result.getPageNumber();

                        if (memo[pageNum]) {
                            memo[pageNum].push(result);
                        } else {
                            memo[pageNum] = [result];
                        }

                        return memo;
                    }, {}).map(function(resultGroup, pageNum) {
                        return function (next) {
                            setTimeout(function(){
                                _.each(resultGroup, function (result) {
                                    // If a pre-existing text selection redaction mark exists in exactly the same position,
                                    // then replace it
                                    var hash = 'T' + PCCViewer.Mark.Type.TextSelectionRedaction + 'P' + result.getPageNumber() + 'I' + result.getStartIndexInPage() + 'L' +  result.getText().length;

                                    if (typeof textSelectionRedactionMarks[hash] !== 'undefined') {
                                        replacedMarks = replacedMarks.concat(textSelectionRedactionMarks[hash]);
                                    }

                                    var mark = viewer.viewerControl.addMarkFromSearchResult(result, PCCViewer.Mark.Type.TextSelectionRedaction);

                                    redactionMarks.push(mark);

                                });

                                next();
                            }, 0);

                        };
                    }).value();

                    viewer.viewerNodes.$searchQuickActionRedact.attr('disabled', 'disabled');

                    parallelSync(redactionTasks, 3, function(err) {
                        if (err) {
                            // Inform the user that the redaction process has failed
                            viewer.notify({
                                message: PCCViewer.Language.data.searchQuickActions.redactionFailed,
                                type: 'error'
                            });
                        } else {
                            // Inform the user that the redaction process has completed
                            viewer.notify({
                                message: PCCViewer.Language.data.searchQuickActions.redactionCompleted,
                                type: 'success'
                            });
                        }

                        if (replacedMarks.length) {
                            viewer.viewerControl.deleteMarks(replacedMarks);
                        }

                        // Update the search terms
                        buildSearchTermUI();

                        // Transition the UI to the next step in the workflow: optionally applying a redaction reason
                        viewer.viewerNodes.$searchQuickActionRedact.removeAttr('disabled');
                        viewer.viewerNodes.$searchQuickActionRedactOptions.removeClass('pcc-hide');
                        viewer.viewerNodes.$searchQuickActionRedactOptions.height(viewer.viewerNodes.$searchQuickActionRedactOptions.height()); // a necessary workaround to get IE11 to display ALL of the options div
                        viewer.viewerNodes.$searchQuickActions.addClass('pcc-hide');
                        viewer.viewerNodes.$searchQuickActions.find('.pcc-redaction-processing').hide();
                        checkedTerms.removeClass('pcc-checked');
                    });
                });

                // When the redaction reason dropdown container is selected, either hide or show the list depending
                // on the current state
                viewer.viewerNodes.$searchQuickActionRedactionDropdownContainer.on('click', function(ev) {
                    $(ev.currentTarget).toggleClass('pcc-active');
                    viewer.viewerNodes.$searchQuickActionRedactionDropdown.toggleClass('pcc-open');
                    edgeForceRepaintWorkaround(viewer.viewerNodes.$searchQuickActionRedactionDropdown);
                });

                // When a specific redaction reason is selected from the drop down list, apply it to the just created
                // redaction marks.
                viewer.viewerNodes.$searchQuickActionRedactionDropdown.find('>div').on('click', function(ev) {

                    // Clicked element
                    var $div = $(this),
                        $parent = viewer.viewerNodes.$searchQuickActionRedactionDropdown,
                        reason;

                    if (options.enableMultipleRedactionReasons) {
                        if ($div.hasClass('pcc-clear-redaction-reasons')) {
                            reason = [];
                            viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(PCCViewer.Language.data.searchQuickActions.redactionReasonDropdownSelect);
                            $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked').removeClass('pcc-checked');
                        } else if ($div.hasClass('pcc-custom-redaction-reasons')) {
                            reason = [viewer.viewerNodes.$searchQuickActionRedactionInput.val()];
                            $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked').removeClass('pcc-checked');
                        } else {
                            // collect all checked reasons
                            $div.toggleClass('pcc-checked');
                            var $checkedReasons = $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked');
                            reason = [];
                            $checkedReasons.each(function(index){
                                reason.push($(this).find('.pcc-select-multiple-redaction-reason').text());
                            });
                            if (reason.length) {
                                viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(getMultipleRedactionReasonsText(reason));
                            } else {
                                viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(PCCViewer.Language.data.searchQuickActions.redactionReasonDropdownSelect);
                            }
                            // Don't close dropdown
                            ev.stopPropagation();
                        }
                    } else {
                        if ($div.hasClass('pcc-clear-redaction-reasons')) {
                            reason = '';
                            viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(PCCViewer.Language.data.searchQuickActions.redactionReasonDropdownSelect);
                        } else if ($div.hasClass('pcc-custom-redaction-reasons')) {
                            reason = viewer.viewerNodes.$searchQuickActionRedactionInput.val();
                        } else {
                            reason = $div.find('.pcc-select-multiple-redaction-reason').text();
                            viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(reason);
                        }
                    }

                    if ($div.hasClass('pcc-custom-redaction-reasons')) {
                        viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.text(PCCViewer.Language.data.redactionReasonFreeform);
                        viewer.viewerNodes.$searchQuickActionRedactionInput.removeClass('pcc-hide');
                    } else {
                        viewer.viewerNodes.$searchQuickActionRedactionInput.addClass('pcc-hide');
                    }

                    _.each(redactionMarks, function(redactionMark) {
                        if(redactionMark) {
                            if (options.enableMultipleRedactionReasons) {
                                redactionMark.setReasons(reason);
                            } else {
                                redactionMark.setReason(reason);
                            }
                        }
                    });
                });

                // When the done button is selected, cleanup the UI and transition back to the search results
                viewer.viewerNodes.$searchQuickActionRedactDone.on('click', function(ev) {

                    redactionMarks = [];

                    // Remove previous user input from the redaction input element and then hide it
                    viewer.viewerNodes.$searchQuickActionRedactionInput.html('').addClass('pcc-hide');

                    // Reset the redaction reason drop down label to the default
                    viewer.viewerNodes.$searchQuickActionRedactionDropdownLabel.html(PCCViewer.Language.data.searchQuickActions.redactionReasonDropdownSelect);

                    // Hide the quick actions and the options
                    viewer.viewerNodes.$searchQuickActions.removeClass('pcc-hide');
                    viewer.viewerNodes.$searchQuickActionRedactOptions.addClass('pcc-hide');

                    // Show the temporarily hidden search terms that were not selected this time around.
                    viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-quick-action-term:not(.pcc-checked)').show();

                    // Transition back to the search results
                    viewer.viewerNodes.$searchQuickActionsToggle.click();

                    // Set the quick action search term section title back to the default
                    viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-section-title').html(PCCViewer.Language.data.searchQuickActions.searchTerms);
                });

                viewer.viewerNodes.$searchQuickActionRedactionInput.on('blur keypress', function(ev) {

                    var $clearItem = viewer.viewerNodes.$searchQuickActionRedactionDropdown.find('[data-clear-item]');

                    var reason = $(this).val();
                    if(ev.type === 'blur' ||
                        (ev.type === 'keypress' && ev.keyCode === 13)) {
                        _.each(redactionMarks, function(redactionMark) {
                            if (options.enableMultipleRedactionReasons) {
                                redactionMark.setReasons([reason]);
                            } else {
                                redactionMark.setReason(reason);
                            }
                        });

                        if (reason.length) {
                            $clearItem.removeClass('pcc-must-hide');
                        } else {
                            $clearItem.addClass('pcc-must-hide');
                        }

                    }
                });

            }

            // Initialize the module by attaching UI event handlers and building data structures to
            // hold predefined search terms.
            var init = function () {
                viewer.$dom.find('.pcc-search-header').on('click', '[data-pcc-search=msg]', function () {
                    viewer.notify({
                        message: this.getAttribute('data-msg')
                    });
                });

                if (viewer.viewerControlOptions.uiElements && viewer.viewerControlOptions.uiElements.advancedSearch === true) {
                    advancedSearchIsOn = true;
                }

                if (typeof viewer.presetSearch !== 'undefined' &&
                    viewer.presetSearch !== null &&
                    Object.prototype.toString.call(viewer.presetSearch.terms) === '[object Array]' &&
                    viewer.presetSearch.terms.length) {

                    buildPresetTerms();
                    buildPresetUI();

                    viewer.viewerNodes.$searchPresetsContainer.on('click', 'label', function (ev) {
                        // stop this from closing the dropdown
                        ev.stopPropagation();
                    });
                } else {
                    viewer.$dom.find('[data-pcc-toggle=dropdown-search-patterns]').hide();
                    viewer.$dom.find('[data-pcc-search=toggleAllPresets]').hide();
                }

                setUIElementsSearch();

                viewer.viewerNodes.$searchCloser.on('click', function () {
                    viewer.$dom.find('[data-pcc-toggle="dialog-search"]').trigger('click');
                });

                // populate redaction reasons filter view
                if (viewer.viewerControlOptions && viewer.viewerControlOptions.redactionReasons) {
                    var fragment = document.createDocumentFragment(),
                        $container = $('[data-pcc-filter-redaction-reasons]');

                    var reasons = [];
                    // Get all reasons from the viewer options
                    if (typeof viewer.viewerControlOptions.redactionReasons.reasons !== 'undefined' && viewer.viewerControlOptions.redactionReasons.reasons.length) {
                        reasons = reasons.concat(viewer.viewerControlOptions.redactionReasons.reasons);
                    }
                    // Add the case where no reason was defined
                    reasons = reasons.concat([{
                      reason: PCCViewer.Language.data.searchFilters.reasonUndefined,
                      _reasonUndefined: true
                    }]);

                    // Display all reasons in the filter UI
                    _.forEach(reasons, function(obj){
                        var div = resultView.elem('div', { className: 'pcc-search-filter pcc-filter-marks' }),
                            checkbox = resultView.elem('div', { className: 'pcc-checkbox pcc-checked' }),
                            icon = resultView.elem('span', { className: 'pcc-icon pcc-icon-check' });

                        div.setAttribute('data-pcc-search-in-marks', 'reason:' + obj.reason);
                        checkbox.setAttribute('data-pcc-checkbox', '');

                        checkbox.appendChild(icon);
                        div.appendChild(checkbox);

                        if (obj._reasonUndefined) {
                          var textNode = document.createTextNode(obj.reason);
                          div.appendChild(textNode);
                        } else {
                          var reasonSpan= resultView.elem('span'),
                              reasonEm = resultView.elem('em', { text: obj.reason });
                          reasonSpan.appendChild(reasonEm);
                          div.appendChild(reasonSpan);

                          if (obj.description) {
                            var separatorNote = document.createTextNode(': '),
                                descriptionSpan = resultView.elem('span', {
                                  class: 'pcc-select-multiple-redaction-description',
                                  text: obj.description
                                });
                            div.appendChild(separatorNote);
                            div.appendChild(descriptionSpan);
                          }
                        }

                        var tooltip = obj.description
                            ? obj.reason + ': ' + obj.description
                            : obj.reason;
                        div.setAttribute('title', tooltip);

                        parseIcons($(div));

                        fragment.appendChild(div);
                    });

                    $container.empty();
                    $container.append(fragment);
                }

                bindQuickActionDOM();
            };

            $event.on('selectResult', function(ev, data){
                // set the active search result node
                var $activeSearchResult = $(data.node);

                if (data.type === 'comment')
                {
                    activeSearchResultId = 'C' + data.result.id;
                } else if (data.type === 'mark') {
                    activeSearchResultId = 'M' + data.result.source.id;
                } else {
                    activeSearchResultId = data.result.id;
                }

                activeResultPageStartIndex = currentResultPageStartIndex;

                // deselect active data-attribute
                viewer.viewerNodes.$searchResults.find('[data-pcc-active-toggle="active"]').removeAttr("data-pcc-active-toggle");

                // select new active result
                $activeSearchResult.attr('data-pcc-active-toggle', 'active');

                // deselect a previously selected result in the search UI
                viewer.viewerNodes.$searchResults.find('.pcc-row.pcc-active').removeClass('pcc-active');

                // select the new result
                $activeSearchResult.addClass('pcc-active');
                // deselect marks that may have been selected from a previous result
                viewer.viewerControl.deselectAllMarks();
                // deselect document search results that may have been selected from a previous result
                viewer.viewerControl.setSelectedSearchResult(null);
                // deselect any comment that may have been selected from a previous result
                $event.trigger('deselectPreviousResult');

                // update search UI to reflect selection
                updatePrevNextButtons();

                var index = $activeSearchResult.index() + 1 + currentResultPageStartIndex,
                    total = searchResultsCount;

                viewer.viewerNodes.$searchResultCount.html(PCCViewer.Language.data.result + index + ' / ' + total);

                // hide results panel on mobile viewports
                viewer.viewerNodes.$searchResultsContainer.addClass('pcc-hide');
                // collapse the expanded panel
                viewer.viewerNodes.$searchDialog.removeClass('pcc-expand')
                      // switch the active results button to off state
                      .find('[data-pcc-search-container-toggle="results"]').removeClass('pcc-active');
            });

            // Generates HTML Elements for various results that can exist in the search bar.
            var resultView = _.clone(genericView);

            resultView.textContext = function(result) {
                var contextElem, emphasis, textBefore, textAfter;

                var contextClassName = advancedSearchIsOn ? 'pcc-col-8' : 'pcc-col-10';
                contextElem = resultView.elem('div', { className: contextClassName });

                // make the selected text interesting
                emphasis = resultView.elem('span', { className: 'match', text: result.getText() });
                emphasis.style.color = result.getHighlightColor();

                // get the text before and after the search hit
                textBefore = result.getContext().substr(0, result.getStartIndexInContext());
                textAfter = result.getContext().substr(result.getText().length + result.getStartIndexInContext());

                // append the text nodes
                // avoid adding blank text nodes
                if (textBefore) {
                    contextElem.appendChild( document.createTextNode('...' + textBefore) );
                }
                contextElem.appendChild( emphasis );
                if (textAfter) {
                    contextElem.appendChild( document.createTextNode(textAfter + '...') );
                }

                return contextElem;
            };

            resultView.searchResult = function(result){
                var searchResult, searchResultPageNumber, searchResultContext;
                var resultId = resultView.selectId(result);

                searchResult = resultView.elem('div', { className: 'pcc-row' });
                searchResult.setAttribute('data-pcc-search-result-id', resultId);

                searchResultPageNumber = resultView.pageNumber( result.getPageNumber() );

                searchResultContext = resultView.textContext(result);

                searchResult.appendChild(searchResultPageNumber);
                searchResult.appendChild(searchResultContext);
                searchResult.appendChild( resultView.typeIcon('page') );

                parseIcons($(searchResult));

                $(searchResult).on('click', function (ev, maintainScrollPosition) {
                    $event.trigger('selectResult', {
                        type: 'search',
                        result: result,
                        node: this
                    });

                    viewer.viewerControl.setSelectedSearchResult(result, !maintainScrollPosition);
                });

                return searchResult;
            };

            resultView.mark = function(result){
                var mark = result.source,
                    text = PCCViewer.Language.data.markType[mark.getType()],
                    type = getSearchResultType(result),
                    markResultId = resultView.selectId(result);

                // check if a line annotation is actually an arrow
                if (mark.getType() === PCCViewer.Mark.Type.LineAnnotation && mark.getEndHeadType() === PCCViewer.Mark.LineHeadType.FilledTriangle){
                    text = PCCViewer.Language.data.markType["ArrowAnnotation"];
                }

                if (type === 'redaction' && mark.getReason && !options.enableMultipleRedactionReasons) {
                    var reason = mark.getReason() || PCCViewer.Language.data.searchFilters.reasonUndefined;
                    text += ' - ' + reason;
                }

                if (type == 'redaction' && mark.getReasons && options.enableMultipleRedactionReasons) {
                    var reason = getMultipleRedactionReasonsText(mark.getReasons()) || PCCViewer.Language.data.searchFilters.reasonUndefined;
                    text += ' - ' + reason;
                }

                var resultElem = resultView.elem('div', { className: 'pcc-row' }),
                    resultPageNumber = resultView.pageNumber( mark.getPageNumber() ),
                    resultContext, icon;

                if (type === 'redaction') {
                    icon = 'annotate-disabled';
                } else if (type === 'signature') {
                    icon = 'esign';
                } else {
                    icon = 'edit';
                }


                resultElem.setAttribute('data-pcc-search-result-id', markResultId);

                if (result instanceof PCCViewer.SearchTaskResult) {
                    // this result is a text-based mark
                    resultContext = resultView.textContext(result);
                } else {
                    // this result is a drawing mark
                    var contextClassName = advancedSearchIsOn ? 'pcc-col-8' : 'pcc-col-10';
                    resultContext = resultView.elem('div', { className: contextClassName, text: text });
                }

                resultElem.appendChild(resultPageNumber);
                resultElem.appendChild(resultContext);
                resultElem.appendChild( resultView.typeIcon(icon) );

                parseIcons($(resultElem));

                $(resultElem).on('click', function(ev, maintainScrollPosition){
                    $event.trigger('selectResult', {
                        type: 'mark',
                        result: result,
                        node: this
                    });

                    // select this mark and scroll to it
                    if (viewer.viewerControl.getMarkById(mark.getId())) {
                        if (maintainScrollPosition !== true) {
                            viewer.viewerControl.selectMarks([mark]);
                            viewer.viewerControl.scrollTo(mark);
                        }

                        // Darken the matching text of the search result within the mark
                        highlightMatchingTextInMark(mark, result);
                    }

                    // register an event to deselect the selectedResult when another result is selected
                    // this will execute only once, on the first result select
                    $event.one('deselectPreviousResult', function () {
                        // check that this mark still exists
                        if (viewer.viewerControl.getMarkById(mark.getId())) {
                            highlightMatchingTextInMark(mark);
                        }
                    });
                });

                return resultElem;
            };

            resultView.comment = function(result){
                var comment = result.source,
                    resultElem = resultView.elem('div', { className: 'pcc-row' }),
                    resultPageNumber = resultView.pageNumber( result.getPageNumber() ),
                    resultContext = resultView.textContext(result),
                    commentResultId = resultView.selectId(result);

                resultElem.appendChild(resultPageNumber);
                resultElem.appendChild(resultContext);
                resultElem.appendChild( resultView.typeIcon('comment') );
                resultElem.setAttribute('data-pcc-search-result-id', commentResultId);

                parseIcons($(resultElem));

                $(resultElem).on('click', function(ev, maintainScrollPosition){
                    $event.trigger('selectResult', {
                        type: 'comment',
                        result: result,
                        node: this
                    });

                    // find all search results for this comment
                    var thisCommentResults = _.filter(searchResults, function(el){
                        return el.source && el.source === result.source;
                    });

                    // select this comment
                    comment.setSessionData('Accusoft-highlight', buildCommentSelectionString(thisCommentResults, result));

                    // re-render the conversation view with the highlight in effect
                    if (viewer.viewerControl.getMarkById(comment.getConversation().getMark().getId())) {
                        viewer.viewerControl.refreshConversations(comment.getConversation());

                        // scroll to the comment
                        if (maintainScrollPosition !== true) {
                        // select the related mark conversation
                        viewer.viewerControl.selectMarks([ comment.getConversation().getMark() ]);

                        if (viewer.viewerControl.getIsCommentsPanelOpen() === false) {
                            viewer.viewerControl.openCommentsPanel();
                        }
                        viewer.viewerControl.scrollTo(comment.getConversation());
                        }

                        // register an event to deselect this comment when another result is selected
                        // this will execute only once, on the first result select
                        $event.one('deselectPreviousResult', function(){
                            comment.setSessionData('Accusoft-highlight', buildCommentSelectionString(thisCommentResults));

                            // check that this mark still exists
                            if (viewer.viewerControl.getMarkById( comment.getConversation().getMark().getId()) ){
                                viewer.viewerControl.refreshConversations(comment.getConversation());
                            }
                        });
                    }

                    // Expand the comment when in skinny mode
                    if (commentUIManager) {
                        commentUIManager.expandComment(comment.getConversation().getMark().getId());
                    }
                });

                return resultElem;
            };

            resultView.select = function(result){
                if (result instanceof PCCViewer.SearchResult) {
                    return resultView.searchResult(result);
                } else if (result instanceof PCCViewer.SearchTaskResult && result.source instanceof PCCViewer.Comment) {
                    return resultView.comment(result);
                } else {
                    return resultView.mark(result);
                }
            };

            resultView.selectId = function(result){
                if (result instanceof PCCViewer.SearchResult) {
                    return result.getId();
                } else if (result instanceof PCCViewer.SearchTaskResult && result.source) {
                    if (result.source instanceof PCCViewer.Comment) {
                        return 'C' + result.commentIndex + '_' + result.getId();
                    } else if (result.source instanceof PCCViewer.Mark) {
                        var mark = result.source;
                        return 'M' + mark.getId() + '_' + result.getId();
                    }
                } else {
                    var mark = result.source;
                    return 'M' + mark.getId();
                }
            };

            resultView.typeIcon = function(icon){
                var result = null;
                if (options.uiElements && options.uiElements.advancedSearch) {
                    result = genericView.elem('div', { className: 'pcc-icon pcc-icon-' + icon });
                } else {
                    result = genericView.elem('div');
                }
                return result;
            };

            // Builds a selection string from a list of comment search results.
            // If a selected result is present, that result will be highlighted differently.
            var buildCommentSelectionString = function (thisCommentResults, selectedResult) {
                return _.reduce(thisCommentResults, function(seed, el) {
                    seed.push(['startIndex=' + el.getStartIndexInInput(),
                               'length=' + el.getText().length,
                               'color=' + el.getHighlightColor(),
                               'opacity=' + ((el === selectedResult) ? 200 : 100)].join('&'));
                    return seed;
                }, []).join('|');
            };

            // Performs a highlight on all of the comment search results in a given collection
            var showAllCommentResults = function(collection){
                var conversations = _.chain(collection).filter(function(el){
                    // find all results in the collection that belong to comments
                    return (el.source && el.source instanceof PCCViewer.Comment);
                }).reduce(function(seed, el){
                    // create collections of each unique comment and all of its selections
                    // one comment can have multiple selections in it
                    var thisCollection = _.find(seed, function(val){
                        return val.source === el.source;
                    });

                    if (thisCollection) {
                        thisCollection.selections.push(el);
                    } else {
                        thisCollection = {
                            source: el.source,
                            selections: [el]
                        };
                        seed.push(thisCollection);
                    }

                    return seed;
                }, []).map(function(el){
                    // build selection strings for each unique comment
                    el.selectionString = buildCommentSelectionString(el.selections);
                    // assign the selection string to be rendered
                    el.source.setSessionData('Accusoft-highlight', el.selectionString);
                    // return the conversation
                    return el.source.getConversation();
                }).value();

                if (conversations.length) {
                    viewer.viewerControl.refreshConversations(conversations);
                }
            };

            // Highlights all search results within the given mark.
            // If selectedResult is passed, then the highlight for that
            // result will be more opaque, making it appear darker in the UI.
            var highlightMatchingTextInMark = function(mark, selectedResult) {
                // Exit without highlighting if given a mark that cannot be highlighted.
                if (!mark || !mark.highlightText) {
                    return;
                }

                // find all text search results for this mark
                var thisMarkResults = _.filter(searchResults, function(el){
                    return (el.source && el.source === mark) &&
                        (el instanceof PCCViewer.SearchTaskResult);
                });

                // Transform these mark search results into an object
                // that is accepted by highlightText.
                thisMarkResults = _.map(thisMarkResults, function(el) {
                    return {
                        startIndex: el.getStartIndexInInput(),
                        length: el.getText().length,
                        color: el.getHighlightColor(),
                        // Reduce the opacity of search result highlights within highlight annotations, when
                        // also searching in document text. This avoids a triple or quad highlight of the
                        // matching text.
                        opacity: (!searchingInDocument || mark.getType() !== PCCViewer.Mark.Type.HighlightAnnotation) ?
                            ((el === selectedResult) ? 200 : 100) :
                            ((el === selectedResult) ? 100 : 0)
                    };
                });

                // highlight text in the mark - this will replace any existing highlights in the mark
                mark.highlightText(thisMarkResults);
            };

            // Performs a highlight on all of the Mark search results in a given collection
            var highlightMatchingTextInMarkResults = function(results) {
                var allMarksWithResults = _.chain(results)
                    .filter(function(result) {
                        return (result.source && result.source instanceof PCCViewer.Mark);
                    })
                    .map(function(result) {
                        return result.source;
                    })
                    .unique().value();

                _.each(allMarksWithResults, function(mark) {
                    highlightMatchingTextInMark(mark);
                });
            };

            // Clear the selection of all comment results in a given collection
            var clearAllCommentResults = function(collection){
                var uniqueConversations = [];

                var conversations = _.chain(collection).filter(function(el){
                    // find all results in the collection that belong to comments
                    return (el.source && el.source instanceof PCCViewer.Comment &&
                        el.source.getSessionData('Accusoft-highlight'));
                }).map(function(el){
                    // push conversations to the unique array if they are not already in there
                    if (!_.contains(uniqueConversations, el.source.getConversation())) {
                        uniqueConversations.push(el.source.getConversation());
                    }

                    // check if there is a highlight to remove
                    el.source.setSessionData('Accusoft-highlight', undefined);
                });

                // check in case some marks were deleted before clearing the results
                var conversationStillAvailable = _.filter(uniqueConversations, function(conv){
                    return !!viewer.viewerControl.getMarkById(conv.getMark().getId());
                });

                // if there are any conversations to clear, do so
                if (conversationStillAvailable.length) {
                    viewer.viewerControl.refreshConversations(conversationStillAvailable);
                }
            };

            // Clear the selection of all mark results in a given collection
            var clearAllMarkResults = function(collection){
                _.forEach(viewer.viewerControl.getAllMarks(), function(mark){
                    if (mark.clearHighlights) {
                        mark.clearHighlights();
                    }
                });
            };

            // Takes the JSON data from predefinedSearch.json and uses it to create normalized search terms. Those are
            // then added to presetSearchTerms.
            var buildPresetTerms = function () {
                var globalOptions = {},
                    term,
                    normalizedTerm,
                    i = 0,
                    highlightColor,
                    fixed;

                if (typeof viewer.presetSearch.globalOptions !== 'undefined') {
                    globalOptions = viewer.presetSearch.globalOptions;
                }

                if (typeof viewer.presetSearch.highlightColor !== 'undefined') {
                    highlightColor = viewer.presetSearch.highlightColor;
                }

                if (typeof viewer.presetSearch.fixed !== 'undefined') {
                    fixed = viewer.presetSearch.fixed;
                }

                _.each(viewer.presetSearch.terms, function(term){
                    normalizedTerm = normalizePresetSearchTerm(term, globalOptions, highlightColor, fixed);
                    var termType = term.type ? $.trim(term.type).toLowerCase() : '';
                    switch(termType){
                        case "proximity":
                            normalizedTerm.terms = _.map(term.terms, function(proximityTerm){
                                return normalizePresetSearchTerm(proximityTerm, globalOptions, highlightColor, fixed);
                            });
                            break;
                    }

                    if (normalizedTerm.fixed === true) {
                        presetFixedSearchTerms.push(normalizedTerm);
                    } else {
                        if (typeof term.selected !== "undefined") {
                            normalizedTerm.selected = term.selected;
                        }

                        presetSearchTerms.push(normalizedTerm);
                    }
                });

                // Show push pin icon in search input box if there are fixed search terms.
                if (presetFixedSearchTerms.length > 0) {
                    $('[data-pcc-toggle="dropdown-search-fixed-box"]').removeClass('pcc-hide');
                    $('[data-pcc-search="clear"]').addClass('pcc-offset-right');
                    $('[data-pcc-section="searchFixedTerms"]').removeClass('pcc-hide');
                }
            };

            var normalizePresetSearchTerm = function(term, globalOptions, highlightColor, fixed){
                term.matchingOptions = typeof term.options === 'undefined' ? {} : term.options;
                var normalizedTerm = {
                    description: term.searchTerm,
                    searchTermIsRegex: false,
                    matchingOptions: {},
                };
                if (typeof highlightColor !== 'undefined') {
                    normalizedTerm.highlightColor = highlightColor;
                }
                if (typeof fixed !== 'undefined') {
                    normalizedTerm.fixed = fixed;
                }
                ['highlightColor', 'fixed', 'type', 'distance', 'searchTerm', 'description', 'searchTermIsRegex'].forEach(function(item) {
                    if (typeof term[item] !== 'undefined') {
                        normalizedTerm[item] = term[item];
                    }
                });
                if (typeof term.userDefinedRegex !== 'undefined') {
                    normalizedTerm.searchTermName = term.searchTerm;
                    normalizedTerm.searchTerm = term.userDefinedRegex;
                }
                ['matchCase', 'endsWith', 'beginsWith', 'matchWholeWord', 'exactPhrase', 'wildcard'].forEach(function(item) {
                    if (typeof globalOptions[item] !== 'undefined') {
                        normalizedTerm.matchingOptions[item] = globalOptions[item];
                    }
                    if (typeof term.matchingOptions[item] !== 'undefined') {
                        normalizedTerm.matchingOptions[item] = term.matchingOptions[item];
                    }
                });
                return normalizedTerm;
            };

            // Adds the search items from predefinedSearch.json to the UI in the form of a dropdown selectable list.
            var buildPresetUI = function () {
                var domElems = [],
                    searchPresetsFragment = document.createDocumentFragment(),
                    searchFixedPresetsFragment = document.createDocumentFragment(),
                    checked;

                function generatePresetDOM(description, id, checked){
                    var label = document.createElement('label'),
                        input = document.createElement('input'),
                        textNode = document.createTextNode(description);

                    input.type = 'checkbox';
                    input.setAttribute('data-pcc-search-preset-id', id);
                    if (checked) {
                        input.setAttribute('checked', 'checked');
                    }

                    label.appendChild(input);
                    label.appendChild(textNode);

                    return label;
                }

                function generateFixedPresetDOM(description){
                    var label = document.createElement('label'),
                        input = document.createElement('input'),
                        textNode = document.createTextNode(description);

                    label.appendChild(textNode);

                    return label;
                }

                $.each(presetFixedSearchTerms, function(i, term){
                    searchFixedPresetsFragment.appendChild( generateFixedPresetDOM(term.description) );
                });

                $.each(presetSearchTerms, function(i, term){
                    checked = (term.selected === true) ? 'checked="checked"' : '';
                    searchPresetsFragment.appendChild( generatePresetDOM(term.description, i, checked) );
                });

                viewer.viewerNodes.$searchPresetsContainer.append(searchPresetsFragment);
                viewer.viewerNodes.$searchFixedPresetsContainer.append(searchFixedPresetsFragment);
            };

            // Add the search terms to the search filter and quick action panes
            var buildSearchTermUI = function() {
                populateSearchTerms(prevSearchQuery, searchResults, $('.pcc-search-filter-container [data-pcc-section=searchTerms] .pcc-section-content'), searchTermFilterClickAction, 'filter', globalUnfixedSearchTerms, true, false);
                populateSearchTerms(prevSearchQuery, searchResults, $('.pcc-search-filter-container [data-pcc-section=searchFixedTerms] .pcc-section-content'), searchTermFilterClickAction, 'filter', globalFixedSearchTerms, false, true);
                populateSearchTerms(prevSearchQuery, searchResults, $('.pcc-search-quick-actions-container [data-pcc-section=quickActionSearchTerms] .pcc-section-content'), searchTermQuickActionClickAction, 'quick-action', globalSearchTerms, true, true, true);
            };

            // When getting ready to execute a search, this functions pulls together all the user selectable
            // search options in to a single search options object.
            var getSearchQuery = function (triggeredFromFilter, excludePresetTerms) {
                var originalQueryString = getQueryString();
                var queryString = originalQueryString,
                    i = 0,
                    presetId, searchTerms = [],
                    isPlaceholder = viewer.viewerNodes.$searchInput.hasClass('pcc-placeholder');

                var isProximitySearch = viewer.viewerNodes.$searchProximity.hasClass('pcc-active');
                var proximityDistance;
                if (isProximitySearch) {
                    proximityDistance = extractProximityDistance(queryString);
                    queryString = removeProximityDistance(queryString);
                }

                var matchingOptions = {
                    exactPhrase: viewer.viewerNodes.$searchExactPhrase.hasClass('pcc-active') ? true : false,
                    matchCase: viewer.viewerNodes.$searchMatchCase.hasClass('pcc-active') ? true : false,
                    matchWholeWord: viewer.viewerNodes.$searchMatchWholeWord.hasClass('pcc-active') ? true : false,
                    beginsWith: viewer.viewerNodes.$searchBeginsWith.hasClass('pcc-active') ? true : false,
                    endsWith: viewer.viewerNodes.$searchEndsWith.hasClass('pcc-active') ? true : false,
                    wildcard: viewer.viewerNodes.$searchWildcard.hasClass('pcc-active') ? true : false,
                    proximity: viewer.viewerNodes.$searchProximity.hasClass('pcc-active') ? true : false
                };

                privateSimpleSearch = true;

                if (triggeredFromFilter) {
                    // This is a request for a searchQuery based on applied filters.

                    // check if the new matching options are the same as the previous ones used in the UI
                    // the user may have changed them before applying a filter
                    var sameMatchingOptions = _.isEqual(matchingOptions, prevMatchingOptions);

                    // get selected unfixed terms from the UI
                    var checkedUnfixedTerms = $('[data-pcc-section="searchTerms"]').find('.pcc-checked');

                    // get selected fixed terms from the UI, and append checked unfixed terms
                    var checkedFixedTerms = $('[data-pcc-section="searchFixedTerms"]').find('.pcc-checked');

                    if (checkedUnfixedTerms.length === 0 && checkedFixedTerms.length === 0) {
                        // no terms are checked, yet we are running a filter...
                        // check if there are any terms present in the first place
                        var allUnfixedTerms = $('[data-pcc-section="searchTerms"]').find('.pcc-filter-term');
                        var allFixedTerms = $('[data-pcc-section="searchFixedTerms"]').find('.pcc-filter-term');

                        if (allUnfixedTerms.length === 0 && allFixedTerms.length === 0) {
                            // this is a filter search (exact same terms) where there were no hits the first time,
                            // so we want to run all terms again
                            return getSearchQuery(false);
                        }
                    }

                    // reset all term options to not be used
                    // also add new UI matching options to user-search terms
                    _.forEach(globalFixedSearchTerms, function(termOption){
                        termOption.isInUse = false;
                    });

                    _.forEach(globalUnfixedSearchTerms, function(termOption){
                        termOption.isInUse = false;

                        if (!sameMatchingOptions && termOption.isUserSearch) {
                            // replace the matching options
                            termOption.searchOption.matchingOptions = matchingOptions;
                        }
                    });

                    if (!sameMatchingOptions) {
                        prevMatchingOptions = _.clone(matchingOptions);
                    }

                    var setSearchTermInUse = function (el, searchTerms) {
                        var term = el.parentElement.getAttribute('data-pcc-filter-term'),
                            searchTerm = searchTerms[term];

                        if (searchTerm) {
                            searchTerm.isInUse = true;
                            return searchTerm.searchOption;
                        } else {
                            return;
                        }
                    };

                    var tempUnfixedTermsArray = _.map(checkedUnfixedTerms, function(el){
                        return setSearchTermInUse(el, globalUnfixedSearchTerms);
                    });

                    var tempFixedTermsArray = _.map(checkedFixedTerms, function(el){
                        return setSearchTermInUse(el, globalFixedSearchTerms);
                    });

                    var tempTermsArray = _.compact(tempFixedTermsArray.concat(tempUnfixedTermsArray));

                    searchTerms = tempTermsArray;
                } else if (isPlaceholder) {
                    // This is a request for a new search, but there is no real text in the input field. This is a
                    // state triggered by the placeholder polyfill. Treat this as a search with no terms.
                    return {
                        searchTerms: []
                    };
                } else {
                    // This is a request for a new searchQuery triggered by the search input field.
                    // Generate new search terms, and save them globally.
                    prevMatchingOptions = _.clone(matchingOptions);

                    if (matchingOptions.exactPhrase) {
                        // We need to match the exact string, as is
                        if (queryString.length) {
                            searchTerms.push({
                                searchTerm: queryString,
                                highlightColor: undefined,
                                searchTermIsRegex: false,
                                contextPadding: 25,
                                matchingOptions: matchingOptions
                            });
                        }
                    } else {
                        // Split up multiple words in the string into separate search term objects
                        var queryArr = queryString.split(' ');
                        queryArr = _.unique(queryArr);
                        _.forEach(queryArr, function(query){
                            if (query.length) {
                                searchTerms.push({
                                    searchTerm: query,
                                    highlightColor: undefined,
                                    searchTermIsRegex: false,
                                    contextPadding: 25,
                                    matchingOptions: matchingOptions
                                });
                            }
                        });
                    }

                    // mark search terms as UI-triggered
                    _.forEach(searchTerms, function(term){
                        term.isUserSearch = true;
                    });

                    if (isProximitySearch && queryString) {
                        var proximitySearchTerm = {
                            type: "proximity",
                            distance: proximityDistance,
                            contextPadding: 25,
                            searchTerm: originalQueryString,
                            prettyName: originalQueryString,
                            terms: searchTerms
                        };

                        searchTerms = [proximitySearchTerm];
                    }

                    if (!excludePresetTerms) {
                        // add preset searches to the terms list
                        if (presetSearchTerms.length) {
                            viewer.$dom.find('input:checked').each(function(i, el){
                                privateSimpleSearch = false;
                                presetId = $(el).data('pccSearchPresetId');
                                searchTerms.push(presetSearchTerms[presetId]);
                            });
                        }
                    }

                    // add preset fixed search to the terms list
                    searchTerms = presetFixedSearchTerms.concat(searchTerms.slice(0));

                    // replace the global query with this new generated one
                    fillGlobalSearchTerms(searchTerms);

                    addPreviousSearch({ searchTerm: originalQueryString, matchingOptions: matchingOptions });
                }

                return {
                    searchTerms: searchTerms
                };
            };

            var fillGlobalSearchTerms = function(searchTerms) {
                _.forEach(searchTerms, function(term){
                    var searchTerm = term.searchTerm;
                    var saveObject = {
                        searchOption: term,
                        prettyName: term.searchTermName || term.searchTerm,
                        prevCount: undefined,
                        isInUse: true,
                        isUserSearch: !!term.isUserSearch
                    };

                    globalSearchTerms[searchTerm] = _.clone(saveObject);
                    globalSearchTerms[searchTerm].searchOption = _.clone(term);

                    if (term.fixed === true) {
                        globalFixedSearchTerms[searchTerm] = saveObject;
                    } else {
                        globalUnfixedSearchTerms[searchTerm] = saveObject;
                    }
                });
            }

            var getQueryString = function(){
                // remove leading and trailing spaces, and replace multiple spaces with a single space
                var queryString = getInputValueNotPlaceholder(viewer.viewerNodes.$searchInput);
                return queryString.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
            };

            var extractProximityDistance = function(searchString){
                var proximityDistanceMatches = getProximityDistanceMatches(searchString);
                if(proximityDistanceMatches){
                    return +proximityDistanceMatches[proximityDistanceMatches.length -1].replace('~', '');
                }
            };

            var removeProximityDistance = function(searchString){
                var proximityDistanceMatches = getProximityDistanceMatches(searchString);
                if(proximityDistanceMatches){
                    _.each(proximityDistanceMatches, function(match){
                        searchString = searchString.replace(match, '');
                    });
                }
                return searchString;
            };

            var getProximityDistanceMatches = function(searchString){
                var proximityDistanceRegex = /(~)(\s+)*(\d+)/gi;
                var proximityDistance;
                return searchString.match(proximityDistanceRegex);
            };

            // This function adds a search query to a UI list of previously executed search terms. Selecting an item
            // from the list will cause it to be re-executed.
            var addPreviousSearch = function (searchTerm) {
                var previousNode,
                    $elPrevSearchDrop = viewer.viewerNodes.$searchPreviousContainer;

                if (typeof previousSearches[searchTerm.searchTerm] !== 'undefined') {
                    return;
                }

                previousSearches[searchTerm.searchTerm] = searchTerm;

                $elPrevSearchDrop.find('.pcc-placeholder').addClass('pcc-hide');

                var root = document.createElement('div'),
                    text = document.createElement('div'),
                    button = document.createElement('div'),
                    textNode = document.createTextNode(searchTerm.searchTerm);

                text.className = 'pcc-search-previous-query';
                text.setAttribute('data-pcc-search-previous-id', searchTerm.searchTerm);
                text.appendChild(textNode);

                button.innerHTML = '&#215;';
                button.setAttribute('data-pcc-search-previous-id', searchTerm.searchTerm);
                button.className = 'pcc-remove-previous';

                root.appendChild(text);
                root.appendChild(button);

                $(text).on('click', function () {
                    previousSelectionHandler(this);
                });

                // execute this only once
                $(button).one('click', function (ev) {
                    ev.stopPropagation();
                    deletePreviousSearch(this);
                });

                $elPrevSearchDrop.prepend(root);
            };

            // When a user selects a previous search query from a list, this function will cause the search to be re-executed.
            var previousSelectionHandler = function (searchNode) {
                var searchTerm,
                    index = searchNode.getAttribute('data-pcc-search-previous-id');

                searchTerm = previousSearches[index];

                viewer.viewerNodes.$searchInput.val(searchTerm.searchTerm);

                setSearchButtons(searchTerm.matchingOptions);

                viewer.viewerNodes.$searchSubmit.click();
            };

            // This function sets the toggle state of the various search option buttons. The state is determined by the
            // btnStates object.
            var setSearchButtons = function (btnStates) {

                // proximity search needs to be first as it disables all other button options.
                if ((btnStates.proximity === true && !viewer.viewerNodes.$searchProximity.hasClass('pcc-active')) ||
                    (btnStates.proximity === false &&
                        viewer.viewerNodes.$searchProximity.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchProximity.click();
                }

                if ((btnStates.wildcard === true && !viewer.viewerNodes.$searchWildcard.hasClass('pcc-active')) ||
                    (btnStates.wildcard === false &&
                        viewer.viewerNodes.$searchWildcard.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchWildcard.click();
                }

                if ((btnStates.exactPhrase === true && !viewer.viewerNodes.$searchExactPhrase.hasClass('pcc-active')) ||
                    (btnStates.exactPhrase === false &&
                        viewer.viewerNodes.$searchExactPhrase.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchExactPhrase.click();
                }

                if ((btnStates.matchCase === true && !viewer.viewerNodes.$searchMatchCase.hasClass('pcc-active')) ||
                    (btnStates.matchCase === false &&
                        viewer.viewerNodes.$searchMatchCase.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchMatchCase.click();
                }

                if ((btnStates.matchWholeWord === true && !viewer.viewerNodes.$searchMatchWholeWord.hasClass('pcc-active')) ||
                    (btnStates.matchWholeWord === false &&
                        viewer.viewerNodes.$searchMatchWholeWord.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchMatchWholeWord.click();
                }

                if ((btnStates.beginsWith === true && !viewer.viewerNodes.$searchBeginsWith.hasClass('pcc-active')) ||
                    (btnStates.beginsWith === false &&
                        viewer.viewerNodes.$searchBeginsWith.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchBeginsWith.click();
                }

                if ((btnStates.endsWith === true && !viewer.viewerNodes.$searchEndsWith.hasClass('pcc-active')) ||
                    (btnStates.endsWith === false &&
                        viewer.viewerNodes.$searchEndsWith.hasClass('pcc-active'))) {
                    viewer.viewerNodes.$searchEndsWith.click();
                }
            };

            // When the user selects the delete icon next to a previous search query, this function will remove
            // it from the displayed list.
            var deletePreviousSearch = function (el) {
                var $parent = $(el).parent(),
                    previousId = $(el).attr("data-pcc-search-previous-id");

                $parent.remove();

                delete previousSearches[previousId];

                if (_.keys(previousSearches).length === 0) {
                    // there are no previous searches
                    viewer.viewerNodes.$searchPreviousContainer.find('.pcc-placeholder').removeClass('pcc-hide');
                }
            };

            // This function causes the search bar to be displayed.
            var showSearchBar = function () {
                viewer.$dom.find('.pcc-row-results-status').removeClass('pcc-done');

                viewer.viewerNodes.$searchResultCount.html(PCCViewer.Language.data.searching);

                $event.trigger('open');
            };

            // As search results are returned to the viewer, this functions can update the progress bar as well as
            // display a text message reflecting the status of the search.
            var updateStatusUi = function (msg, showLoader, barWidth) {
                if (msg.length) {
                    viewer.viewerNodes.$searchResultCount.html(msg);
                    parseIcons(viewer.viewerNodes.$searchResultCount);
                }

                if (typeof showLoader === 'boolean' && showLoader === true) {
                    viewer.viewerNodes.$searchResultsContainer.addClass('pcc-loading');
                    viewer.viewerNodes.$searchStatus.show();
                } else {
                    viewer.viewerNodes.$searchResultsContainer.removeClass('pcc-loading');
                    viewer.viewerNodes.$searchStatus.hide();
                }

                if (typeof barWidth === 'number') {

                    if (barWidth < 0) {
                        barWidth = 0;
                    } else if (barWidth > 100) {
                        barWidth = 100;
                    }

                    viewer.$dom.find('.pcc-row-results-status .pcc-bar').css('width', barWidth + '%');
                }
            };

            // Sorts an array of live DOM elements (already in the DOM)
            // It will also work with a jQuery-wrapped array
            var sortDOM = (function(){
                var sort = [].sort;

                return function(elems, comparator) {
                    // Sort the elements.
                    // Make sure to get the pure elements array out of the jQuery wrapper.
                    var sortCollection = sort.call($(elems).get(), comparator);

                    // Check to make sure we have items in the collection
                    if (sortCollection.length === 0) {
                        return;
                    }

                    // Save the first element, and insert it as the first
                    var prev = sortCollection.shift();
                    $(prev).insertBefore(prev.parentNode.firstChild);

                    // Insert the rest of the elements in order
                    $(sortCollection).each(function(i, el) {
                        //$(el).insertAfter(prev);
                        el.parentNode.insertBefore(el, prev.nextSibling);
                        prev = el;
                    });
                };
            })();

            var getSearchResultType = function(result) {
                if (result instanceof PCCViewer.SearchResult) {
                    return 'search';
                }

                if (result.source && result.source instanceof PCCViewer.Mark) {
                    var type = result.source.getType();

                    if (type.match(/redaction/i)) { return 'redaction'; }
                    else if (type.match(/annotation/i)) { return 'annotation'; }
                    else if (type.match(/signature/i)) { return 'signature'; }
                }

                if (result.source && result.source instanceof PCCViewer.Comment) {
                    return 'comment';
                }

                return 'unknown';
            };

            // This function will sort the search results DOM elements, and fir the even/odd classnames.
            // It can be a bit slow for large result sets, so it should be throttled when executing in a loop.
            var sortAndColorCorrectResultsView = function(){
                var allResultsChildren = allResultsFragment.childNodes;

                // Sort the live DOM elements
                sortDOM(allResultsChildren, function(a, b){
                    function getDataFromAttributes($e) {
                        return {
                            pccPageNumber : $e.attr("data-pcc-page-number"),
                            pccSortIndex : $e.attr("data-pcc-sort-index"),
                            pccRectY : $e.attr("data-pcc-rect-y"),
                            pccRectX : $e.attr("data-pcc-rect-x"),
                            pccAdtlIndex : $e.attr("data-pcc-adtl-index")
                        };
                    }

                    // get the data attributes out of the DOM
                    var aData = getDataFromAttributes($(a));
                    var bData = getDataFromAttributes($(b));

                    // sort based on the sorting attributes
                    return (aData.pccPageNumber !== bData.pccPageNumber) ? aData.pccPageNumber - bData.pccPageNumber :
                           (aData.pccSortIndex !== bData.pccSortIndex) ? aData.pccSortIndex - bData.pccSortIndex :
                           (aData.pccRectY !== bData.pccRectY) ? aData.pccRectY - bData.pccRectY :
                           (aData.pccRectX !== bData.pccRectX) ? aData.pccRectX - bData.pccRectX :
                           (aData.pccAdtlIndex !== bData.pccAdtlIndex) ? aData.pccAdtlIndex - bData.pccAdtlIndex : 0;
                });

                // Update the currently displayed search results.
                showResultsSubset(currentResultPageStartIndex);
                viewer.viewerNodes.$searchNextResult.removeAttr('disabled');
            };

            // Appends to the results view given partial results.
            // This function will throttle DOM building and sorting for large amounts of data.
            var partialResultsTimeout,
                delayCount = 0;
            var buildPartialResultsView = function(partialSearchResults) {
                var rectangle = {},
                    typeClass = '',
                    searchResult, resultsVerbiage, searchResultId;

                var searchTasks = _.chain(partialSearchResults)
                    .reduce(function (memo, result) {
                        var pageNum = result.getPageNumber();
                        if (memo[pageNum]) {
                            memo[pageNum].push(result);
                        } else {
                            memo[pageNum] = [result];
                        }
                        return memo;
                    }, {})
                    .map(function (resultGroup, pageNum) {
                        var requestText = false;

                        _.each(resultGroup, function(result) {
                            searchResult = resultView.select(result);
                            searchResultId = resultView.selectId(result);


                            // if there is a previously selected relevant result,
                            // restore it
                            if (activeSearchResultRestoreId === searchResultId) {
                                activeSearchResultRestoreId = null;
                                var originalActiveResultPageStartIndex = activeResultPageStartIndex;
                                $(searchResult).trigger('click', true);
                                activeResultPageStartIndex = originalActiveResultPageStartIndex;
                            }

                            typeClass = 'pcc-search-result-' + getSearchResultType(result);
                            $(searchResult).addClass(typeClass);

                            // Get the primary sort index for this search result.
                            var sortIndex = (result.index !== undefined) ? result.index : result.getStartIndexInPage();

                            // If the sort index is equal to -2, then this is a mark or comment search result and
                            // we want to resort it based on position relative to page text.
                            if (sortIndex === -2 && result.index === -2) {
                                requestText = true;

                                searchResultsToResort.push({
                                    domElement: searchResult,
                                    searchResult: result
                                });
                            }

                            // Add sorting parameters to the DOM element
                            searchResult.setAttribute('data-pcc-page-number', result.getPageNumber());
                            searchResult.setAttribute('data-pcc-sort-index', sortIndex);

                            // Add an additional sorting parameter to use for multiple hits in one object
                            var additionalIndex = (result instanceof PCCViewer.SearchResult) ? result.getStartIndexInPage() :
                                                  (result instanceof PCCViewer.SearchTaskResult) ? result.getStartIndexInInput() : 0;
                            searchResult.setAttribute('data-pcc-adtl-index', additionalIndex);

                            rectangle = result.getBoundingRectangle();
                            searchResult.setAttribute('data-pcc-rect-x', rectangle.x);
                            searchResult.setAttribute('data-pcc-rect-y', rectangle.y);

                            allResultsFragment.appendChild(searchResult);

                            searchResultsCount++;

                            resultsVerbiage = (searchResultsCount === 1) ? PCCViewer.Language.data.searchResultFound : PCCViewer.Language.data.searchResultsFound;

                            updateStatusUi(searchResultsCount + resultsVerbiage, true, 100 * (result.getPageNumber() / viewer.pageCount));
                        });
                        return function (next) {
                            if (requestText) {
                                ensurePageTextIsRequested(Number(pageNum), next);
                            } else {
                                next();
                            }
                        };
                    }).value();

                parallelSync(searchTasks, 3, function(err) {
                    if (err) {
                        viewer.notify({
                            message: PCCViewer.Language.data.searchQuickActions.searchFailed,
                            type: 'error'
                        });
                    }
                });

                // Display relatively small result sets immediately.
                if (searchResults.length < resultsPageLength) {
                    if (searchResults.length) {
                        sortAndColorCorrectResultsView();
                    }
                } else {
                    // Gradually build up the trottle.
                    // The user will see the first results right away, and the
                    // bottom of the list will populate a little more slowly. This
                    // avoids expensive rendering by the browser when the user can't
                    // see the effects.
                    var delay = Math.min(200 * (delayCount), 1000);

                    delayCount += 1;
                    if (partialResultsTimeout) {
                        clearTimeout(partialResultsTimeout);
                        partialResultsTimeout = undefined;
                    }

                    partialResultsTimeout = setTimeout(sortAndColorCorrectResultsView, delay);
                }
            };

            var showResultsSubset = function (startIndex) {
                var subsetFragment = document.createDocumentFragment();

                currentResultPageStartIndex = startIndex;

                if (currentResultPageStartIndex > 0) {
                    viewer.viewerNodes.$searchPrevResultsPage.removeAttr('disabled');
                }
                else {
                    viewer.viewerNodes.$searchPrevResultsPage.attr('disabled', 'disabled');
                }

                var allResultsChildren = allResultsFragment.childNodes;
                var endIndex;
                if (searchResultsCount > currentResultPageStartIndex + resultsPageLength) {
                    viewer.viewerNodes.$searchNextResultsPage.removeAttr('disabled');
                    endIndex = currentResultPageStartIndex + resultsPageLength;
                }
                else {
                    viewer.viewerNodes.$searchNextResultsPage.attr('disabled', 'disabled');
                    endIndex = searchResultsCount;
                }

                // Clone the results that should be showing currently.
                var i;
                for (i = currentResultPageStartIndex; i < endIndex; i++) {
                    var subsetResult = $(allResultsChildren[i]).clone(true);
                    subsetFragment.appendChild(subsetResult[0]);
                }

                viewer.viewerNodes.$searchResults.empty();
                viewer.viewerNodes.$searchResults.append(subsetFragment);
                viewer.viewerNodes.$searchResults.scrollTop(0);

                if (activeSearchResultId !== undefined) {
                    var $activeSearchResult = viewer.viewerNodes.$searchResults.find("[data-pcc-search-result-id='" + activeSearchResultId + "']");
                    $activeSearchResult.addClass('pcc-active');
                    $activeSearchResult.attr('data-pcc-active-toggle', 'active');
                    if (allResultsFragment.childNodes.length > activeResultPageStartIndex + resultsPageLength && activeResultPageStartIndex > 0) {
                        updatePrevNextButtons();
                    }
                }

                // The order of DOM elements has changed, so add and remove .pcc-odd class as needed
                viewer.viewerNodes.$searchResults.find('.pcc-row:even').removeClass('pcc-odd');
                viewer.viewerNodes.$searchResults.find('.pcc-row:odd').addClass('pcc-odd');
            };

            viewer.viewerNodes.$searchPrevResultsPage.on('click', function (ev) {
                ev.preventDefault();
                showResultsSubset(currentResultPageStartIndex - resultsPageLength);
            });
            viewer.viewerNodes.$searchNextResultsPage.on('click', function (ev) {
                ev.preventDefault();
                showResultsSubset(currentResultPageStartIndex + resultsPageLength);
            });

            var searchTermFilterClickAction = function(){
                $(this).find('[data-pcc-checkbox]').toggleClass('pcc-checked');

                // some GC cleanup magic
                onFilterDismissFunction = undefined;
                onFilterDismissFunction = function() {
                    // Execute a new search using only the filtered items
                    executeSearch(true);
                };
            };

            var searchTermQuickActionClickAction = function(){
                $(this).find('[data-pcc-checkbox]').toggleClass('pcc-checked');
                var searchTerms = viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-quick-action-search-term');

                var checkedTerms = viewer.viewerNodes.$searchQuickActionsSearchTerms.find('.pcc-checked');

                if ( checkedTerms.length === 0 || !searchRequest.getIsComplete || !searchRequest.getIsComplete() || !searchResultsCount) {
                    viewer.viewerNodes.$searchQuickActionRedact.attr('disabled', true);
                }
                else if (checkedTerms.length < searchTerms.length) {
                    viewer.viewerNodes.$searchQuickActionRedact.removeAttr('disabled', true);
                    viewer.viewerNodes.$searchRedact.html(PCCViewer.Language.data.searchQuickActions.redactSelected);
                } else {
                    viewer.viewerNodes.$searchQuickActionRedact.removeAttr('disabled', true);
                    viewer.viewerNodes.$searchRedact.html(PCCViewer.Language.data.searchQuickActions.redactAll);
                }
            };

            // Triggered when a partial set of search results is available. This triggers one final time before the
            // search completes. Properties appended to the event object: .partialSearchResults
            var partialSearchResultHandler = function (ev) {

                // append the partial results to the results collection
                searchResults.push.apply(searchResults, ev.partialSearchResults);

                buildPartialResultsView(ev.partialSearchResults);

                // Update the filter UI if results were added
                if (ev.partialSearchResults && ev.partialSearchResults.length) {
                    buildSearchTermUI();
                }
            };

            // Triggered when search has completed due to failure, abort, or when the full set of search results is available.
            var searchCompletedHandler = function (ev) {
                unHookSearchResultEvents();

                var resultsVerbiage = (searchResultsCount === 0) ? PCCViewer.Language.data.nothingFound : '',
                    pagesWithoutTextMsg = '',
                    countPagesWithoutText, pagesWithoutTextWarning = '';

                updateStatusUi(resultsVerbiage, false, 100);

                viewer.viewerNodes.$searchCancel.addClass('pcc-hide');
                viewer.viewerNodes.$searchInput.removeAttr('disabled');
                viewer.viewerNodes.$searchClear.removeAttr('disabled');
                viewer.viewerNodes.$searchSubmit.removeClass('pcc-hide');
                viewer.viewerNodes.$searchStatus.addClass('pcc-done');

                if (searchResults.length) {
                    viewer.viewerNodes.$searchQuickActionRedact.removeAttr('disabled');
                }

                viewer.viewerNodes.$searchResultsContainer.addClass('pcc-show-lg');

                countPagesWithoutText = searchRequest.getPagesWithoutText ? searchRequest.getPagesWithoutText().length : 0;

                if (viewer.pageCount === countPagesWithoutText) {
                    var currentSearchStatusWording = viewer.viewerNodes.$searchResultCount.html();

                    pagesWithoutTextWarning = currentSearchStatusWording + '<span class="pcc-icon pcc-icon-alert" data-pcc-search="msg" data-msg="{{MSG}}"></span>'
                        .replace('{{MSG}}', PCCViewer.Language.data.noSearchableText);
                } else if (countPagesWithoutText > 0) {
                    var currentSearchStatusWording = viewer.viewerNodes.$searchResultCount.html();

                    pagesWithoutTextMsg = countPagesWithoutText + ' ' + PCCViewer.Language.data.cannotSearch;

                    pagesWithoutTextWarning = currentSearchStatusWording + '<span class="pcc-icon pcc-icon-alert" data-pcc-search="msg" data-msg="{{MSG}}"></span>'
                        .replace('{{MSG}}', pagesWithoutTextMsg);
                }

                if (pagesWithoutTextWarning.length) {
                    updateStatusUi(pagesWithoutTextWarning, false, 100);
                }
            };

            // Triggered when the search has completed due to failure.
            var searchFailedHandler = function (ev) {
                var msg = PCCViewer.Language.data.searchError + searchRequest.getErrorMessage();

                unHookSearchResultEvents();
                updateStatusUi(PCCViewer.Language.data.searchCancelled, false, 100);

                viewer.viewerNodes.$searchCancel.addClass('pcc-hide');
                viewer.viewerNodes.$searchInput.removeAttr('disabled');
                viewer.viewerNodes.$searchClear.removeAttr('disabled');
                viewer.viewerNodes.$searchInput.removeAttr('disabled');
                viewer.viewerNodes.$searchClear.removeAttr('disabled');
                viewer.viewerNodes.$searchSubmit.removeClass('pcc-hide');

                viewer.notify({
                    message: msg
                });
            };

            // Triggered when the search has completed due to a call to cancel.
            var searchCancelledHandler = function (ev) {
                unHookSearchResultEvents();
                updateStatusUi(PCCViewer.Language.data.searchCancelled, false, 100);

                viewer.viewerNodes.$searchCancel.addClass('pcc-hide');
                viewer.viewerNodes.$searchSubmit.removeClass('pcc-hide');
            };

            // Triggered when the search has completed because the full set of search results is available.
            var searchResultsAvailableHandler = function () {
                updateStatusUi('', false, 100);
            };

            // Detaches all event associated with executing a search.
            var unHookSearchResultEvents = function () {
                if (searchRequest instanceof PCCViewer.SearchRequest) {
                    searchRequest.off('PartialSearchResultsAvailable', partialSearchResultHandler);
                    searchRequest.off('SearchCompleted', searchCompletedHandler);
                    searchRequest.off('SearchFailed', searchFailedHandler);
                    searchRequest.off('SearchCancelled', searchCancelledHandler);
                    searchRequest.off('SearchResultsAvailable', searchResultsAvailableHandler);
                }
            };

            // Resets the module's properties used to track search results.
            var resetSearchParams = function () {
                searchResultsCount = 0;
                activeSearchResultId = undefined;
                $(allResultsFragment).children().off();
                while (allResultsFragment.firstChild) {
                    allResultsFragment.removeChild(allResultsFragment.firstChild);
                }
                redactionMarks = [];
            };

            // If the viewer's searchOnInit options is set to true, then this function will cause a search to be executed.
            var initialSearchHandler = function () {
                if (viewer.presetSearch.searchOnInit === true) {
                    viewer.presetSearch.searchOnInit = false; // only fire once
                    setTimeout(function () {
                        viewer.viewerNodes.$searchSubmit.click();
                    }, 1200);
                }
            };

            var populateSearchTerms = function(searchQuery, results, $container, clickAction, classFragment, terms, includeUnfixed, includeFixed, hideNotInUse) {
                if (_.size(terms) === 0) {
                    return;
                }

                var fragment = document.createDocumentFragment();

                $container.empty();

                // get count of results by term
                var resultsByTerm = _.reduce(results, function(seed, res){
                    // filter out marks search from filters view
                    if (res.getSearchTerm) {
                        var termOptions = res.getSearchTerm(),
                            term = '',
                            prettyName = '';

                        term = termOptions.searchTerm;

                        if ((termOptions.fixed && !includeFixed) || (!termOptions.fixed && !includeUnfixed)) {
                            return seed;
                        }

                        prettyName = terms[term].prettyName;

                        seed[term] = seed[term] || {
                            count: 0,
                            color: res.getHighlightColor(),
                            prettyName: prettyName,
                            originalTerm: term
                        };

                        seed[term].count += 1;
                    }

                    return seed;
                }, {});

                // Display the processed terms and counts in the filters view
                _.forEach(terms, function(globalResultElem, termName) {
                    var localResultElem = resultsByTerm[termName],
                        localColor = '#ffffff',
                        localCount = 0,
                        persistColor = true;

                    if (localResultElem) {
                        // This term has hits in the current search
                        localCount = localResultElem.count;
                        localColor = localResultElem.color || localColor;
                    } else if (!globalResultElem.isInUse) {
                        // This term was not used, so we need to keep its previous data
                        localCount = globalResultElem.prevCount;
                        localColor = globalResultElem.searchOption.highlightColor || localColor;
                    } else {
                        // This term has no hits in this
                        localCount = 0;
                        localColor = globalResultElem.searchOption.highlightColor || localColor;

                        // do not persist colors in this case, since the color has not been assigned yet
                        persistColor = false;
                    }

                    // If the term is not in use, zero out the count
                    if (!globalResultElem.isInUse) {
                        localCount = 0;
                    }

                    // Persist new count and auto-assigned colors in the global search term objects
                    globalResultElem.prevCount = localCount;
                    if (persistColor) {
                        globalResultElem.searchOption.highlightColor = localColor;
                    }

                    // If the element should be hidden when not in use, continue to the next element
                    if (hideNotInUse && !globalResultElem.isInUse) {
                        return;
                    }

                    // If the element should not be included because it is not a fixed search term, continue to the next element
                    if (!includeUnfixed && !globalResultElem.searchOption.fixed) {
                        return;
                    }

                    // If the element should not be included because it is a fixed search term, continue to the next element
                    if (!includeFixed && globalResultElem.searchOption.fixed) {
                        return;
                    }

                    var checkboxClassName = globalResultElem.isInUse ?
                            'pcc-checkbox pcc-checked' :
                            'pcc-checkbox',
                        div = resultView.elem('div', { className: 'pcc-search-' + classFragment + ' pcc-' + classFragment + '-term pcc-row' }),
                        count = resultView.elem('span', { className: 'pcc-term-count pcc-col-1', text: localCount }),
                        checkbox = resultView.elem('div', { className: checkboxClassName }),
                        icon = resultView.elem('span', { className: 'pcc-icon pcc-icon-check' }),
                        text = resultView.elem('span', { className: 'pcc-' + classFragment + '-search-term pcc-col-9', text: globalResultElem.prettyName }),
                        backgroundColor = PCCViewer.Util.layerColors({ color: localColor, opacity: 100 }, '#ffffff');

                    count.style.backgroundColor = backgroundColor;

                    checkbox.setAttribute('data-pcc-checkbox', '');
                    checkbox.appendChild(icon);
                    div.appendChild(checkbox);
                    div.appendChild(text);
                    div.appendChild(count);

                    div.setAttribute('data-pcc-' + classFragment + '-term', termName);
                    div.setAttribute('data-pcc-' + classFragment + '-count', globalResultElem.prevCount);

                    var $div = $(div).on('click', clickAction);

                    parseIcons($div);

                    fragment.appendChild(div);
                });

                $container.append(fragment);

                // Sort the hit filters based on count
                // Highest count will appear toward the top
                sortDOM($container.children(), function(a, b){
                    var aData = $(a).data('pcc-' + classFragment + '-count'),
                        bData = $(b).data('pcc-' + classFragment + '-count');

                    return bData - aData;
                });
            };

            // Causes a user initiated search to be executed.
            var executeSearch = function (isRerun, retainUI, excludePresetTerms) {
                if (isRerun !== true) {
                    // this is a new search, so we should not preserve anything
                    // previously selected
                    activeSearchResultId = undefined;
                    activeSearchResultRestoreId = null;
                } else if (activeSearchResultId !== undefined) {
                    // if this is a rerun, like maybe from a filter, make
                    // sure to save the state of the selected result so that
                    // we can restore it later
                    activeSearchResultRestoreId = activeSearchResultId;
                }
                $event.off('deselectPreviousResult');

                searchResultsCount = 0;

                // clear quick action panel
                resetQuickActionMenu();

                // reset advanced search DOM nodes
                $advancedSearchToggle.removeClass('pcc-active');
                $advancedSearchPanel.removeClass('pcc-open');

                // blur the search input box
                viewer.viewerNodes.$searchInput.blur();

                // clear results DOM
                viewer.viewerNodes.$searchResults.empty();
                resetSearchParams();
                // clear the search from the viewer
                viewer.viewerControl.clearSearch();
                // reset the results throttle variables
                delayCount = 0;
                // delete the previous search request object
                if (searchRequest instanceof PCCViewer.SearchRequest) {
                    // Setting this explicitly before reassigning will explicitly release the previous
                    // request, and anything it may have in scope, to GC.
                    searchRequest = undefined;
                    searchRequest = {};
                }
                // clear the onFilterDismiss function, as it is no longer valid
                onFilterDismissFunction = undefined;
                // clear active search result
                activeSearchResultId = undefined;
                // clear comment highlights
                clearAllCommentResults(searchResults);
                // clear mark highlights
                clearAllMarkResults();

                // reset previous search results
                searchResults = [];

                // reset previous set of search results to resort
                searchResultsToResort = [];

                // unless this is a filtered search, reset the global search cache
                if (!isRerun) {
                    globalSearchTerms = {};
                    globalUnfixedSearchTerms = {};
                }

                currentResultPageStartIndex = 0;

                // get areas to search in from the UI buttons
                var searchIn = _.reduce( $('[data-pcc-search-in].pcc-active'), function(seed, el){
                    var location = el.getAttribute('data-pcc-search-in');
                    seed[location] = true;
                    seed.filterCount += 1;

                    return seed;
                }, { filterCount: 0 });

                // Track within the module, whether or not we are searching the document text.
                searchingInDocument = searchIn.document ? true : false;

                if (!advancedSearchIsOn) {
                    // advanced search is disabled, so we should only search in the document
                    searchIn.document = true;
                    searchIn.filterCount = 1;
                }

                // check if searching in any content was requested
                if (!searchIn.filterCount) {
                    // execute a search complete and exit this method
                    searchCompletedHandler();
                    return;
                }

                var searchQuery = getSearchQuery(!!isRerun, excludePresetTerms),
                    serverValid = viewer.viewerControl.validateSearch(searchQuery),
                    errorMsg = [];

                // Save the search query to be used for search area filters
                prevSearchQuery = searchQuery;

                // reset the search terms views
                buildSearchTermUI();

                viewer.viewerNodes.$searchNextResult.attr('disabled', 'disabled');
                viewer.viewerNodes.$searchPrevResult.attr('disabled', 'disabled');
                viewer.viewerNodes.$searchNextResultsPage.attr('disabled', 'disabled');
                viewer.viewerNodes.$searchPrevResultsPage.attr('disabled', 'disabled');

                // Check to see if all terms were unchecked in the UI
                if (searchQuery.searchTerms.length === 0) {
                    // Open results panel and update state
                    if (retainUI !== true) {
                    showSearchBar();
                    }

                    // Attempt to only show marks.
                    // Do not search in mark text, as there are no text queries
                    searchIn.markText = false;
                    executeMarksSearch(searchQuery, searchIn);

                    // There are no search terms to look for
                    searchCompletedHandler();

                    return;
                }

                // Validate proximity search
                var proximityTerm = _.find(searchQuery.searchTerms, function(searchTerm){
                    return searchTerm.type === 'proximity';
                });
                if(proximityTerm){
                    if(!proximityTerm.distance){
                        viewer.notify({
                            message: PCCViewer.Language.data.proximitySearchMissingDistanceError || 'Incorrect syntax. Use ~n format to specify the distance of the proximity search. \n\n Example: term1 term2 ~3',
                            sticky: true
                        });
                        updateStatusUi(PCCViewer.Language.data.nothingFound, false, 100);
                        return;
                    }

                    if(proximityTerm.terms.length !== 2) {
                        viewer.notify({
                            message: proximityTerm.terms.length > 2 ?
                                PCCViewer.Language.data.proximitySearchTooManyTermsError || 'You can only specify two search terms in a proximity search':
                                PCCViewer.Language.data.proximitySearchNotEnoughTermsError || 'You must specify at least two search terms in a proximity search',
                            sticky: true
                        });
                        updateStatusUi(PCCViewer.Language.data.nothingFound, false, 100);
                        return;
                    }
                }

                if (serverValid.errorsExist) {
                    if (typeof serverValid.summaryMsg !== 'undefined') {
                        errorMsg.push(serverValid.summaryMsg);
                    } else {
                        for (var i = 0; i < serverValid.searchTerms.length; i++) {
                            var termObj = serverValid.searchTerms[i];

                            if (!termObj.isValid) {
                                errorMsg.push(termObj.message);
                            }
                        }
                    }

                    viewer.notify({
                        message: _.uniq(errorMsg, true).join(' ')
                    });

                    return;
                }

                updateStatusUi(PCCViewer.Language.data.searching, true, 100);

                viewer.viewerNodes.$searchSubmit.addClass('pcc-hide');
                viewer.viewerNodes.$searchCancel.removeClass('pcc-hide');
                viewer.viewerNodes.$searchInput.attr('disabled', 'disabled');
                viewer.viewerNodes.$searchClear.attr('disabled', 'disabled');

                viewer.$dom.find('.pcc-dropdown').removeClass('pcc-open');

                if (retainUI !== true) {
                    showSearchBar();
                }

                // Queue search in document first, since it is asynchronous and takes time
                if (searchIn.document) {
                    searchRequest = viewer.viewerControl.search(searchQuery);

                    searchRequest.on('PartialSearchResultsAvailable', partialSearchResultHandler);
                    searchRequest.on('SearchCompleted', searchCompletedHandler);
                    searchRequest.on('SearchFailed', searchFailedHandler);
                    searchRequest.on('SearchCancelled', searchCancelledHandler);
                    searchRequest.on('SearchResultsAvailable', searchResultsAvailableHandler);
                }

                // Search marks if requested
                // This is synchronous and relatively fast
                if (searchIn.annotations || searchIn.redactions || searchIn.signatures) {
                    executeMarksSearch(searchQuery, searchIn);
                }

                // Search comments if requested
                // This is synchronous and relatively fast
                if (searchIn.comments) {
                    executeCommentsSearch(searchQuery);
                }

                // Show the results panel, so user can see results start to come in
                viewer.viewerNodes.$searchResultsContainer.addClass('pcc-show-lg');

                // If not searching in document, then the search is now done at this point
                if (!searchIn.document) {
                    searchCompletedHandler();
                }

                viewer.viewerNodes.$searchQuickActionRedact.attr('disabled', true);
                resetQuickActionMenu();
            };

            var executeMarksSearch = function(searchQuery, searchIn){
                // augment searchIn object with mark specific options
                searchIn = _.reduce( $('[data-pcc-search-in-marks]'), function(seed, el) {

                    // Ignore this filter if it's not checked
                    if (!$(el).find('.pcc-checked')[0]) {
                        return seed;
                    }

                    var location = el.getAttribute('data-pcc-search-in-marks');
                    seed[location] = true;
                    seed.filterCount += 1;

                    return seed;
                }, searchIn);

                if (searchQuery.searchTerms.length === 0) {
                    // do not search in mark text if there are no terms to search
                    searchIn.markText = false;
                }

                var allTextMarks = [],
                    allDrawingMarks = [],
                    redactionReasons = [],
                    results = [];

                // Filter all marks into local collections based on type and whether the user requested them.
                _.forEach(viewer.viewerControl.getAllMarks(), function(mark){
                    var category = (mark.getType().match(/redaction/i)) ? 'redactions' :
                                   (mark.getType().match(/signature/i)) ? 'signatures' : 'annotations';

                    if (!searchIn[category]) {
                        // this mark was not requested
                        return;
                    }

                    // filter redactions with reasons at this point, which will be searched separately
                    if (mark.getReason) {
                        redactionReasons.push(mark);
                        return;
                    }

                    if (mark.getText && searchIn.markText && category !== 'signatures') {
                        allTextMarks.push(mark);
                    } else if (searchIn.showAllTypes) {
                        allDrawingMarks.push(mark);
                    }
                });

                // normalize all marks results
                function pushResults(mark, resultArray){
                    results.push.apply(results, _.map(resultArray, function(res){
                        res.source = mark;
                        res.index = viewer.viewerControl.getCharacterIndex(mark);
                        res.getPageNumber = function(){ return mark.getPageNumber(); };
                        res.getBoundingRectangle = function(){ return mark.getBoundingRectangle(); };

                        return res;
                    }));
                }

                // Search inside all text-based marks that were added to local collections
                if (allTextMarks.length && searchIn.markText) {
                    var searchTask = new PCCViewer.SearchTask(searchQuery);

                    _.forEach(allTextMarks, function(mark){
                        var res = searchTask.search(mark.getText());
                        pushResults(mark, res);
                    });
                }

                // Search through all redactions with reasons added to local collections
                if (redactionReasons.length) {
                    // find all reasons that the user requested to see
                    var reasonsToShow = [];
                    _.chain(searchIn).keys().forEach(function(name){
                        if (name.match('reason:')) {
                            reasonsToShow.push( name.replace('reason:', '') );
                        }
                    });

                    // check if each redaction has a requested reason
                    _.forEach(redactionReasons, function(mark){
                        var thisReasons;
                        if (options.enableMultipleRedactionReasons) {
                            var thisReasons = mark.getReasons();
                            if (thisReasons.length === 0) {
                                thisReasons = [PCCViewer.Language.data.searchFilters.reasonUndefined];
                            }
                        } else {
                            thisReasons = [mark.getReason() || PCCViewer.Language.data.searchFilters.reasonUndefined];
                        }
                        if (_.intersection(reasonsToShow, thisReasons).length > 0) {
                            pushResults(mark, [{}]);
                        }
                });
                }

                // Display all drawing-based marks added to local collections
                if (allDrawingMarks.length) {
                    _.forEach(allDrawingMarks, function(mark){
                        // It's okay to add an empty object as the result, since the normalizer will add
                        // all of the required data from a plain drawing mark.
                        pushResults(mark, [{}]);
                    });
                }


                // handle all marks results as partial results
                partialSearchResultHandler({ partialSearchResults: results });

                // highlight the text in mark results
                highlightMatchingTextInMarkResults(results);
            };

            var executeCommentsSearch = function(searchQuery){
                var searchTask = new PCCViewer.SearchTask(searchQuery),
                    results = [],
                    commentIndex = 0;

                function searchComments(comments) {
                    _.each(comments, function(c) {
                        var resultsInComment = searchTask.search(c.getText()),
                            markIndex = viewer.viewerControl.getCharacterIndex(c.getConversation().getMark());

                        if (resultsInComment.length) {

                            _.forEach(resultsInComment, function(result){
                                // augment the properties of the result object
                                result.source = c;
                                result.index = markIndex;
                                result.commentIndex = commentIndex;
                                result.getPageNumber = function(){ return c.getConversation().getMark().getPageNumber(); };
                                result.getBoundingRectangle = function(){ return c.getConversation().getMark().getBoundingRectangle(); };

                            });

                            results = results.concat( resultsInComment );
                            commentIndex++;
                        }
                    });
                }

                var allCoversationsWithComments = _.chain(viewer.viewerControl.getAllMarks()).filter(function(mark){
                    return mark.getConversation().getComments().length;
                }).each(function(mark){
                    searchComments( mark.getConversation().getComments() );
                });

                partialSearchResultHandler({ partialSearchResults: results });

                showAllCommentResults(results);
            };

            // When a the 'wild card' button is selected, this function will manage the toggle state of other buttons
            // that are logically affected by the change in this button's toggle state.
            var wildcardClickHandler = function (wildcard) {
                if (checkDisabled($(wildcard))) {
                    return false;
                }

                $(wildcard).toggleClass('pcc-active');

                if ($(wildcard).hasClass('pcc-active')) {
                    viewer.viewerNodes.$searchMatchWholeWord.removeClass('pcc-active').addClass('pcc-disabled');
                    viewer.viewerNodes.$searchBeginsWith.removeClass('pcc-active').addClass('pcc-disabled');
                    viewer.viewerNodes.$searchEndsWith.removeClass('pcc-active').addClass('pcc-disabled');
                    viewer.viewerNodes.$searchExactPhrase.removeClass('pcc-active').addClass('pcc-disabled');
                } else {
                    viewer.viewerNodes.$searchMatchWholeWord.removeClass('pcc-disabled');
                    viewer.viewerNodes.$searchBeginsWith.removeClass('pcc-disabled');
                    viewer.viewerNodes.$searchEndsWith.removeClass('pcc-disabled');
                    viewer.viewerNodes.$searchExactPhrase.removeClass('pcc-disabled');
                }

                return true;
            };

            // When beginsWith is selected endsWith should not be
            var beginsWithClickHandler = function (beginsWith) {
                if (checkDisabled($(beginsWith))) {
                    return false;
                }

                $(beginsWith).toggleClass('pcc-active');

                if ($(beginsWith).hasClass('pcc-active')) {
                    viewer.viewerNodes.$searchEndsWith.removeClass('pcc-active')
                }

                return true;
            };

            // When endsWith is selected beginsWith should not be
            var endsWithClickHandler = function (endsWith) {
                if (checkDisabled($(endsWith))) {
                    return false;
                }

                $(endsWith).toggleClass('pcc-active');

                if ($(endsWith).hasClass('pcc-active')) {
                    viewer.viewerNodes.$searchBeginsWith.removeClass('pcc-active')
                }

                return true;
            };

            // When a search button is selected, this function will manage the toggle state of itself
            // if additional buttons should be affected than the button needs its own click handler
            var genericSearchButtonClickHandler = function(btnElement) {
                var $btnElement = $(btnElement);
                if(checkDisabled($btnElement)) {
                    return false;
                }
                $btnElement.toggleClass('pcc-active');
                return true;
            };

            var checkDisabled = function ($btnElement) {
                return $btnElement.hasClass('pcc-disabled');
            };

            // When the 'proximity' button is selected, this function will manage the toggle state of other buttons
            // that are logically affected by the change in this button's toggle state.
            var proximityClickHandler = function(proximitySearchButton) {
                if(checkDisabled($(proximitySearchButton))) {
                    return false;
                }
                $(proximitySearchButton).toggleClass('pcc-active');

                // Create array of affected buttons
                var affectedButtons = $.map([
                    viewer.viewerNodes.$searchExactPhrase,
                    viewer.viewerNodes.$searchMatchCase,
                    viewer.viewerNodes.$searchMatchWholeWord,
                    viewer.viewerNodes.$searchBeginsWith,
                    viewer.viewerNodes.$searchEndsWith,
                    viewer.viewerNodes.$searchWildcard
                ], function(element){
                    return element[0];
                });

                if ($(proximitySearchButton).hasClass('pcc-active')) {
                    viewer.viewerNodes.$searchInput.attr('placeholder', PCCViewer.Language.data.proximitySearchPlaceholder);
                    $(affectedButtons).removeClass('pcc-active').addClass('pcc-disabled');
                } else{
                    viewer.viewerNodes.$searchInput.attr('placeholder', PCCViewer.Language.data.searchDocument);
                    $(affectedButtons).removeClass('pcc-disabled');
                }

                return true;
            };

            // Selecting the Next button in the search result list causes the following search result to be selected and
            // displayed.
            var nextResultClickHandler = function (nextResultBtn) {
                if (searchResultsCount === 0 || $(nextResultBtn).attr('disabled')) {
                    return false;
                }

                var results = viewer.viewerNodes.$searchResults;
                var $activeSearchResult;

                if (activeSearchResultId === undefined) {
                    $activeSearchResult = results.children(":first");
                    $activeSearchResult.click();
                } else {
                    if (activeResultPageStartIndex !== currentResultPageStartIndex) {
                        // Navigate to the page containing the active search result.
                        showResultsSubset(activeResultPageStartIndex);
                    }

                    $activeSearchResult = results.find('[data-pcc-active-toggle="active"]').next();

                    if ($activeSearchResult.length) {
                        activeSearchResultId = $activeSearchResult.attr('data-pcc-search-result-id');
                        $activeSearchResult.click();
                        results.scrollTop(results.scrollTop() + $activeSearchResult.position().top - 200);
                    }
                    else {
                        showResultsSubset(currentResultPageStartIndex + resultsPageLength);
                        $activeSearchResult = $(results.children()[0]);
                        activeSearchResultId = $activeSearchResult.attr('data-pcc-search-result-id');
                        $activeSearchResult.click();
                    }
                }

                updatePrevNextButtons();
            };

            // Selecting the Previous button in the search result list causes the previous search result to be selected and
            // displayed.
            var previousResultClickHandler = function (previousResultBtn) {
                if (searchResultsCount === 0 || $(previousResultBtn).attr('disabled')) {
                    return false;
                }

                var results = viewer.viewerNodes.$searchResults;
                var $activeSearchResult;

                if (activeSearchResultId === undefined) {
                    $activeSearchResult = results.children(":last");
                    $activeSearchResult.click();
                } else {
                    if (activeResultPageStartIndex !== currentResultPageStartIndex) {
                        // Navigate to the page containing the active search result.
                        showResultsSubset(activeResultPageStartIndex);
                    }

                    $activeSearchResult = results.find('[data-pcc-active-toggle="active"]').prev();

                    if ($activeSearchResult.length) {
                        activeSearchResultId = $activeSearchResult.attr('data-pcc-search-result-id');
                        $activeSearchResult.click();
                        results.scrollTop(results.scrollTop() + $activeSearchResult.position().top - 200);
                    }
                    else {
                        showResultsSubset(currentResultPageStartIndex - resultsPageLength);
                        results.scrollTop(results.prop('scrollHeight'));
                        $activeSearchResult = $(results.children()[resultsPageLength - 1]);
                        activeSearchResultId = $activeSearchResult.attr('data-pcc-search-result-id');
                        $activeSearchResult.click();
                    }
                }

                updatePrevNextButtons();
            };

            // This function manages the state of the Previous and Next navigation buttons in the search results list.
            var updatePrevNextButtons = function () {
                var $activeSearchResult = viewer.viewerNodes.$searchResults.find('[data-pcc-active-toggle="active"]');
                var hasNextResult = $activeSearchResult.next().length > 0 || allResultsFragment.childNodes.length > activeResultPageStartIndex + resultsPageLength;
                var hasPrevResult = $activeSearchResult.prev().length > 0 || activeResultPageStartIndex > 0;

                if (hasNextResult) {
                    viewer.viewerNodes.$searchNextResult.removeAttr('disabled');
                }
                else {
                    viewer.viewerNodes.$searchNextResult.attr('disabled', 'disabled');
                }

                if (hasPrevResult) {
                    viewer.viewerNodes.$searchPrevResult.removeAttr('disabled');
                }
                else {
                    viewer.viewerNodes.$searchPrevResult.attr('disabled', 'disabled');
                }
            };

            // This function updates the search results list after session change
            var refresh = function() {
                if (viewer.viewerControl.searchRequest) {
                    searchRequest = viewer.viewerControl.searchRequest;
                    searchResults = searchRequest.results;

                    if (viewer.viewerControl.selectedSearchResult) {
                        activeSearchResultId = viewer.viewerControl.selectedSearchResult.id;
                    }

                    globalUnfixedSearchTerms = {};
                    globalSearchTerms = {};
                    fillGlobalSearchTerms(searchRequest.searchQuery.searchTerms);

                    // Show the results panel, so user can see results start to come in
                    viewer.viewerNodes.$searchResultsContainer.addClass('pcc-show-lg');

                    buildPartialResultsView(searchResults);
                    if (searchResults && searchResults.length) {
                        buildSearchTermUI();
                    }

                    if (searchRequest.errorMessage) {
                        searchFailedHandler();
                    }
                    if (searchRequest.isComplete) {
                        searchCompletedHandler();
                    }
                }
            };

            var cancelAndClearSearchResults = function() {
                unHookSearchResultEvents();
                cancelSearch();

                searchRequest = {};
                searchResults = [];
                resetSearchParams();

                viewer.viewerNodes.$searchResults.empty();
                viewer.viewerNodes.$searchResultCount.html(PCCViewer.Language.data.searchResultsNone);

                viewer.viewerNodes.$searchResultsContainer.removeClass('pcc-loading');
                viewer.viewerNodes.$searchStatus.hide();

                // clear quick action panel
                resetQuickActionMenu();
                // clear the filter terms list
                resetFilterTermsList();
            };

            // When the user chooses to clear the current search, this function cleans up the UI and associated data
            // structures.
            var clearSearch = function (ev) {
                var elDialog = viewer.$dom.find('.pcc-dialog-search');

                searchRequest = {};

                viewer.viewerNodes.$searchInput.val('');
                // disable the previous and next buttons
                elDialog.find('button[data-pcc-search]').prop('disabled', true);

                // If there are fixed search terms, execute a search for those instead of clearing all results.
                if (presetFixedSearchTerms.length > 0) {

                    executeSearch(false, false, true);
                    setSearchButtons({
                        "matchCase": false,
                        "endsWith": false,
                        "beginsWith": false,
                        "matchWholeWord": false,
                        "exactPhrase": false
                    });
                    return;
                }

                searchResultsToResort = [];

                viewer.viewerNodes.$searchResults.empty();
                viewer.viewerNodes.$searchResultCount.html(PCCViewer.Language.data.searchResultsNone);

                viewer.$dom.find('.pcc-row-results-status').addClass('pcc-hide');

                viewer.$dom.find('[data-pcc-toggle-id=dropdown-search-patterns] input').prop('checked', false);

                resetSearchParams();
                // clear the search in viewer control
                if (viewer.viewerReady) {
                    viewer.viewerControl.clearSearch();
                }
                // clear comment highlights
                clearAllCommentResults(searchResults);
                // clear mark highlights
                clearAllMarkResults();
                // clear quick action panel
                resetQuickActionMenu();
                // clear the filter terms list
                resetFilterTermsList();

                setSearchButtons({
                    "matchCase": false,
                    "endsWith": false,
                    "beginsWith": false,
                    "matchWholeWord": false,
                    "exactPhrase": false
                });
            };

            // When user cancels a running search, this function updates the UI and also informs the API of
            // cancellation.
            var cancelSearch = function () {
                viewer.viewerNodes.$searchSubmit.removeClass('pcc-hide');
                viewer.viewerNodes.$searchCancel.addClass('pcc-hide');
                viewer.viewerNodes.$searchInput.removeAttr('disabled');
                viewer.viewerNodes.$searchClear.removeAttr('disabled');

                if (searchRequest instanceof PCCViewer.SearchRequest) {
                    searchRequest.cancel();
                }
            };

            var setUIElementsSearch = function(){
                if(advancedSearchIsOn){
                    // show the advanced search elements
                    $searchContainerToggles.removeClass('pcc-hide');
                    $searchContainerToggles.addClass('pcc-show');
                    $advancedSearchColumnHeader.eq(1).removeClass('pcc-col-10');
                    $advancedSearchColumnHeader.eq(1).addClass('pcc-col-8');
                    $advancedSearchColumnHeader.eq(2).removeClass('pcc-hide');
                    $advancedSearchColumnHeader.eq(2).addClass('pcc-show');
                } else {
                    // advanced search is off
                    viewer.viewerNodes.$searchFilterContainer.empty();
                }
            };

            $searchContainerToggles.on('click', function(ev){
                var $this = $(this),
                    which = $this.data('pccSearchContainerToggle'),
                    wasActive = $this.hasClass('pcc-active'),
                    hideAllClass = 'pcc-hide pcc-hide-lg';

                if (wasActive) {
                    // turn off this toggle
                    $this.removeClass('pcc-active');

                    viewer.viewerNodes.$searchDialog.removeClass('pcc-expand');
                } else {
                    // turn on this toggle
                    $searchContainerToggles.removeClass('pcc-active');
                    $this.addClass('pcc-active');

                    viewer.viewerNodes.$searchDialog.addClass('pcc-expand');
                }

                // toggle was flipped, so flip the bool
                var isActive = !wasActive;

                if (isActive) {

                    // Hide all containers
                    $searchContainers.addClass(hideAllClass);

                    // Show current container
                    $searchContainers.filter('[data-pcc-search-container="' + which + '"]').removeClass(hideAllClass);

                    // Hide the search results navigation
                    if (which !== 'results') {
                        viewer.viewerNodes.$searchDialog.find('.pcc-search-nav').addClass('pcc-hide');
                    }

                    // If opening a container other than filters, call the onDismiss function
                    if (which !== 'filter' && onFilterDismissFunction && typeof onFilterDismissFunction === 'function') {
                        onFilterDismissFunction();
                    }
                } else {

                    // Hide current container
                    $searchContainers.filter('[data-pcc-search-container="' + which + '"]').addClass(hideAllClass);

                    // Show the default search results panel
                    if (which !== 'results') {
                        viewer.viewerNodes.$searchResultsContainer.removeClass(hideAllClass);
                        viewer.viewerNodes.$searchDialog.find('.pcc-search-nav').removeClass('pcc-hide');
                    }

                    // If closing filters, call the onDismiss function
                    if (which === 'filter' && onFilterDismissFunction && typeof onFilterDismissFunction === 'function') {
                        onFilterDismissFunction();
                    }
                }
            });

            // Request page text for a page only when text is not loaded in the viewer
            // and only if it has not previosly been requested for this page.
            var pageTextRequested = [];
            var ensurePageTextIsRequested = function(pageNumber, cb) {
                pageTextRequested[pageNumber] = pageTextRequested[pageNumber] ||
                    viewer.viewerControl.isPageTextReady(pageNumber);
                if (pageTextRequested[pageNumber] !== true) {
                    viewer.viewerControl.requestPageText(pageNumber).then(function() {
                        cb();
                    }, function(err) {
                        cb(err);
                    });
                } else {
                    cb();
                }


            };

            // When page text is ready, re-sort any mark or comment search results that need
            // to be sorted based on position relative to text.
            var resortOnPageTextReady = function(ev) {
                if (searchResultsToResort && searchResultsToResort.length !== 0) {
                    // We can re-sort search results for the page where text is ready
                    var resultsForPage = _.filter(searchResultsToResort, function(result) {
                        return result.searchResult.getPageNumber() === ev.pageNumber;
                    });

                    if (resultsForPage && resultsForPage.length !== 0) {
                        // Remove results that we are re-sorting from the list of results to re-sort
                        searchResultsToResort = _.difference(searchResultsToResort, resultsForPage);

                        _.each(resultsForPage, function (result) {
                            var newSortIndex = -2;
                            if (result.searchResult.source instanceof PCCViewer.Comment) {
                                newSortIndex = viewer.viewerControl.getCharacterIndex(result.searchResult.source.getConversation().getMark());
                            } else {
                                newSortIndex = viewer.viewerControl.getCharacterIndex(result.searchResult.source);
                            }
                            result.domElement.setAttribute('data-pcc-sort-index', newSortIndex);
                        });

                        sortAndColorCorrectResultsView();
                    }
                }
            };

            // Perform any changes that need to occur when text is ready for a page.
            var pageTextReadyHandler = function(ev) {
                resortOnPageTextReady(ev);
            };

            // Restores search highlight after text selection based mark created.
            function bindRestoringSearchHighlight() {
                var textSelection;
                viewer.viewerControl.on(PCCViewer.EventType.TextSelected, function(ev) {
                    textSelection = ev.textSelection;
                });

                viewer.viewerControl.on(PCCViewer.EventType.MarkCreated, function(ev) {
                    // Ensure there is text selection, mark was created with mouse
                    if (textSelection && ev.clientX && ev.clientY)
                        // Ensure mark has text selection based type
                        if (ev.mark.getType() === PCCViewer.Mark.Type.HighlightAnnotation ||
                            ev.mark.getType() === PCCViewer.Mark.Type.TextSelectionRedaction ||
                            ev.mark.getType() === PCCViewer.Mark.Type.StrikethroughAnnotation ||
                            ev.mark.getType() === PCCViewer.Mark.Type.TextHyperlinkAnnotation) {
                            viewer.viewerControl.clearMouseSelectedText(textSelection)
                            textSelection = null;
                    }
                });
            };

            // Initialize the module.
            init();

            // Show and hide filter sections when the titles are clicked on
            $searchFilterSections.on('click', '.pcc-section-title', function(){
                var $section = $(this).parent('.pcc-section');

                $section.toggleClass('pcc-expand');
            });

            $('[data-pcc-search-in]').on('click', function(ev){
                // change the state of this toggle
                $(this).toggleClass('pcc-active');

                // some GC cleanup magic
                onFilterDismissFunction = undefined;
                onFilterDismissFunction = function() {
                    // run a new search with the new settings
                    executeSearch(true);
                };
            });

            // Rerun search whenever one of the search areas is turned on or off
            $('[data-pcc-search-in-marks]').on('click', function(ev){
                var checkedClass = 'pcc-checked',
                    $this = $(this),
                    which = $this.attr('data-pcc-search-in-marks');

                $this.find('[data-pcc-checkbox]').toggleClass(checkedClass);

                // some GC cleanup magic
                onFilterDismissFunction = undefined;
                onFilterDismissFunction = function() {
                    executeSearch(true);
                };
            });

            // The publicly accessible members of this module.
            return {
                initialSearchHandler: initialSearchHandler,
                executeSearch: executeSearch,
                wildcardClickHandler: wildcardClickHandler,
                matchWholeWordClickHandler: genericSearchButtonClickHandler,
                beginsWithClickHandler: beginsWithClickHandler,
                endsWithClickHandler: endsWithClickHandler,
                exactPhraseClickHandler: genericSearchButtonClickHandler,
                matchCaseClickHandler: genericSearchButtonClickHandler,
                proximityClickHandler: proximityClickHandler,
                nextResultClickHandler: nextResultClickHandler,
                previousResultClickHandler: previousResultClickHandler,
                clearSearch: clearSearch,
                cancelSearch: cancelSearch,
                refresh: refresh,
                cancelAndClearSearchResults: cancelAndClearSearchResults,
                pageTextReadyHandler: pageTextReadyHandler,
                bindRestoringSearchHighlight: bindRestoringSearchHighlight,
                on: function(name, func) {
                    $event.on(name, func);
                },
                off: function(name, func) {
                    $event.off(name, func);
                }
            };
        })();

        // The annotationIo module manages the loading and saving of annotations between the
        // viewer and the web tier.
        this.annotationIo = (function () {

            // Contains the current state of annotations in regards to whether they are saved or not to the web tier.
            var annotationDirty = false,

            // Clone the generic view generator to allow us to make results in annotations
                resultView = _.clone(genericView),

                // The name of the currently loaded annotation record.
                currentlyLoadedAnnotation,

            // The jQuery selector for the dialog window warning of an existing annotation record with the same name.
                $overwriteOverlay,

            // The jQuery selector for the dialog window warning of unsaved annotation changes.
                $unSavedChangesOverlay,

            // The jQuery selector for the generic overlay background.
                $overlayFade,

            // This is a container object that maps annotation record ids (as keys) to annotation record objects (as values)
                markupRecords = {},

                modes = {
                    loadClassic: "load",
                    saveClassic: "save",
                    loadMarkupLayers: "loadMarkupLayers",
                    saveMarkupLayers: "saveMarkupLayers"
                },
                loadedReviewMarkupLayers = {},
                loadedReviewMarkupXml = {},
                loadedEditMarkupLayer,
                toggleAllReviewLayers,
                recordsLoadPending = 0;

            function getLayerComments(layer) {
                var marks = viewer.viewerControl.getAllMarks(),
                    comments = [];

                _.each(marks, function(mark) {
                    comments = comments.concat(mark.getConversation().getComments());
                });

                comments = _.filter(comments, function(comment) {
                    return comment.getMarkupLayer() && comment.getMarkupLayer().getId() === layer.getId();
                });

                return comments;
            }

            function setLayerCommentsOwner(layer) {
                var layerComments = getLayerComments(layer);

                _.each(layerComments, function(comment) {
                    if (typeof comment.getData('Accusoft-owner') === 'undefined') {
                        comment.setData('Accusoft-owner', layer.getName());
                    }
                });

                viewer.viewerControl.refreshConversations();
            }

            // Initialize the module by attaching UI event handlers and by attaching listeners for events that
            // modify annotations.
            var init = function () {

                loadedEditMarkupLayer = viewer.viewerControl.getActiveMarkupLayer();

                var updateReviewLayerLoadUi = function(recordId, operation, operationSuccessful) {

                    var disabled = false;

                    var $recordEl = viewer.viewerNodes.$annotationLayersList.find('[data-pcc-annotation-layer-record-id="' + recordId + '"]');

                    if (!$recordEl.length) {
                        $recordEl = viewer.viewerNodes.$annotationLayersList.find('[data-pcc-annotation-xml-record-id="' + recordId + '"]');
                    }

                    if ( (operation === 'loadReviewXmlRecord' || operation === 'loadReviewLayerRecord') && operationSuccessful) {
                        $recordEl.addClass('pcc-checked');
                        recordsLoadPending--;
                    } else if ( (operation === 'loadReviewXmlRecord' || operation === 'loadReviewLayerRecord') && !operationSuccessful) {
                        $recordEl.removeClass('pcc-checked');
                        recordsLoadPending--;
                    } else {
                        $recordEl.removeClass('pcc-checked');
                    }

                    $recordEl.data('pcc-loading', 'false');
                    $recordEl.find('.pcc-load').hide();
                    $recordEl.find('.pcc-checkbox').show();

                    // The following elements should only be updated if there are no pending records to load
                    if (recordsLoadPending === 0) {
                        $(toggleAllReviewLayers).find('.pcc-load').hide();
                        $(toggleAllReviewLayers).find('.pcc-checkbox').show();
                        $(toggleAllReviewLayers).data('pcc-loading', 'false');

                        if ($.isEmptyObject(loadedReviewMarkupLayers) && $.isEmptyObject(loadedReviewMarkupXml) && !loadedEditMarkupLayer) {
                            disabled = true;
                        }

                        viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.doneButton);
                        viewer.viewerNodes.$annotationLayersDone.prop('disabled', disabled);
                        viewer.viewerNodes.$annotationLayersBack.prop('disabled', false);
                    }

                    parseIcons($recordEl);

                };

                annotationModificationListeners();

                viewer.viewerNodes.$annotateSaveDialog.find('input').on('keydown', function (event) {
                    return handleFilenameInput(this, event);
                });

                viewer.viewerNodes.$annotateSaveDialog.find('button').on('click', function () {

                    var fieldVal = viewer.viewerNodes.$annotateSaveDialog.find('input').val();
                    safeSave(fieldVal);
                });

                viewer.viewerNodes.$annotationList.on('click', '.pcc-row', function () {

                    handleLoadSelection(this);

                });

                // Handle selection of layer record in the 'for editing' dropdown
                viewer.viewerNodes.$annotationLayersDropdown.on('click', '.pcc-annotation-layer-record', function (ev) {

                    var recordId = $(this).attr('data-pcc-annotation-layer-record-id');

                    // If there is no layer record ID, the marks are stored in XML.
                    // Get the XML record ID instead, and load the marks from XML.
                    if (recordId === undefined) {

                        // If the record is already loaded, notify the user and do not load again
                        if (loadedReviewMarkupXml[viewer.viewerControl.getActiveMarkupLayer().getOriginalXmlName()] ) {
                            viewer.notify({
                                message: PCCViewer.Language.data.annotationLayerAlreadyLoaded
                            });

                            return;
                        }

                        // If an editable layer is previously loaded, then clear it away first
                        if (viewer.viewerControl.getActiveMarkupLayer()) {
                            unloadLayerRecord(viewer.viewerControl.getActiveMarkupLayer().getRecordId(), function(){});
                        }

                        loadEditXmlRecord($(this).attr('data-pcc-annotation-xml-record-id'));
                        return;
                    }

                    // If the record is already loaded, notify the user and do not load again
                    if (loadedReviewMarkupLayers[recordId] ) {
                        viewer.notify({
                            message: PCCViewer.Language.data.annotationLayerAlreadyLoaded
                        });

                        return;
                    }

                    // If an editable layer is previously loaded, then clear it away first
                    if (viewer.viewerControl.getActiveMarkupLayer()) {
                        unloadLayerRecord(viewer.viewerControl.getActiveMarkupLayer().getRecordId(), function(){});
                    }

                    // Load the record and track it as the layer loaded for editing
                    loadEditLayerRecord(recordId);

                });

                // Handle selection of layer record in the 'for review' list
                viewer.viewerNodes.$annotationLayersList.on('click', '.pcc-annotation-layer-record', function (ev) {

                    if ($(this).data('pcc-loading') === 'true' ) {
                        return;
                    }

                    $(this).data('pcc-loading', 'true');
                    $(this).find('.pcc-checkbox').hide();
                    var $loader = $(this).find('.pcc-load').show().addClass('pcc-icon pcc-icon-loader');
                    updateIcon($loader);

                    var recordId = $(this).attr('data-pcc-annotation-layer-record-id');

                    // If there is no layer record ID, the marks are stored in XML.
                    // Get the XML record ID instead, and load the marks from XML.
                    if (recordId === undefined) {

                        var xmlLayerName = $(this).attr('data-pcc-annotation-xml-record-id');

                        // If the record is already loaded, notify the user and do not load again
                        if (viewer.viewerControl.getActiveMarkupLayer() && xmlLayerName === viewer.viewerControl.getActiveMarkupLayer().getOriginalXmlName()) {
                            viewer.notify({
                                message: PCCViewer.Language.data.annotationLayerAlreadyLoaded
                            });

                            return;
                        }

                        // Load the record and track it as a layer loaded for review
                        if (!$(this).hasClass('pcc-checked')) {
                            recordsLoadPending++;
                            loadReviewXmlRecord(xmlLayerName, updateReviewLayerLoadUi);
                        } else {
                            var xmlLayer = loadedReviewMarkupXml[xmlLayerName];
                            viewer.viewerControl.deleteMarks(xmlLayer.getMarks());
                            delete loadedReviewMarkupXml[xmlLayerName];
                            xmlLayer.destroy();
                            updateReviewLayerLoadUi(xmlLayerName, 'unloadXmlLayer', true);
                        }

                        return;
                    }

                    // If the record is already loaded, notify the user and do not load again
                    if (viewer.viewerControl.getActiveMarkupLayer() && recordId === viewer.viewerControl.getActiveMarkupLayer().getRecordId()) {
                        viewer.notify({
                            message: PCCViewer.Language.data.annotationLayerAlreadyLoaded
                        });

                        return;
                    }

                    // Load the record and track it as a layer loaded for review
                    if (!$(this).hasClass('pcc-checked')) {
                        recordsLoadPending++;
                        loadReviewLayerRecord(recordId, updateReviewLayerLoadUi);
                    } else {
                        unloadLayerRecord(recordId, updateReviewLayerLoadUi);
                    }
                });

                if (options.annotationsMode === viewer.annotationsModeEnum.LegacyAnnotations &&
                    options.autoLoadAnnotation === true &&
                    typeof options.annotationID === 'string') {

                    loadMarkupRecord({name: options.annotationID});
                    viewer.viewerControl.setPageNumber(1);
                }

                viewer.viewerNodes.$annotationLayersDone.on('click', function(ev){
                    var otherMarkupLayers = $.map($.extend({}, loadedReviewMarkupLayers, loadedReviewMarkupXml), function(value) {

                        if (value.getSessionData('Accusoft-state') !== 'merged') {
                            return value;
                        }

                    });

                    var currentMarkupLayer = viewer.viewerControl.getActiveMarkupLayer();

                    viewer.annotationLayerReview.onOpenDialog(currentMarkupLayer, otherMarkupLayers);
                    openDialog({ toggleID: 'dialog-annotation-layer-review' });
                });

            };

            var refresh = function() {
                loadedEditMarkupLayer = viewer.viewerControl.getActiveMarkupLayer();
                $('.pcc-select-load-annotation-layers .pcc-label').text(PCCViewer.Language.data.annotationLayersLoad);

                loadedReviewMarkupLayers = {};
                loadedReviewMarkupXml = {};

                if (loadDialogIsOpen()) {
                    if (options.annotationsMode === viewer.annotationsModeEnum.LayeredAnnotations) {
                        loadAllRecords();
                    } else {
                        loadMarkupList();

                        if (currentlyLoadedAnnotation) {
                            updateLoadStatusMsg(PCCViewer.Language.data.annotations.load.status + currentlyLoadedAnnotation);
                        } else {
                            updateLoadStatusMsg('');
                        }
                    }
                }
            };

            var loadReviewXmlRecord = function (xmlRecordName, done) {

                viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.annotationLayerLoading);
                viewer.viewerNodes.$annotationLayersDone.prop('disabled', true);
                viewer.viewerNodes.$annotationLayersBack.prop('disabled', true);

                // Create a new layer to add the mark (loaded from XML) to
                var markupLayerCollection = viewer.viewerControl.getMarkupLayerCollection();
                var xmlLayer = new PCCViewer.MarkupLayer(viewer.viewerControl);
                markupLayerCollection.addItem(xmlLayer);
                xmlLayer.setName(xmlRecordName);
                xmlLayer.setOriginalXmlName(xmlRecordName);

                viewer.viewerControl.loadMarkup(xmlRecordName, {
                    retainExistingMarks: true,
                    markupLayer: xmlLayer
                }).then(

                    function onResolve(){
                        loadedReviewMarkupXml[xmlRecordName] = xmlLayer;

                        disableAllLayerMarks(xmlLayer);

                        // Loop through comments and set the owner
                        setLayerCommentsOwner(xmlLayer);

                        done(xmlRecordName, 'loadReviewXmlRecord', true);
                    },

                    function onReject(reason) {
                        xmlLayer.destroy();
                        viewer.notify({message: PCCViewer.Language.data.annotationLayerLoadFailed});
                        done(xmlRecordName, 'loadReviewXmlRecord', false);
                    }

                );
            };

            var loadReviewLayerRecord = function (layerRecordId, done) {

                viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.annotationLayerLoading);
                viewer.viewerNodes.$annotationLayersDone.prop('disabled', true);
                viewer.viewerNodes.$annotationLayersBack.prop('disabled', true);

                viewer.viewerControl.loadMarkupLayers(layerRecordId).then(

                    function onResolve(annotationLayers) {
                        loadedReviewMarkupLayers[annotationLayers[0].getRecordId()] = annotationLayers[0];

                        disableAllLayerMarks(annotationLayers[0]);

                        // open the comments panel if comments are detected
                        commentUIManager.openIfVisibleMarks();

                        done(layerRecordId, 'loadReviewLayerRecord', true);
                    },

                    function onReject(reason) {
                        viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.doneButton);
                        viewer.notify({message: PCCViewer.Language.data.annotationLayerLoadFailed});
                        done(layerRecordId, 'loadReviewLayerRecord', false);
                    }

                );
            };

            var loadEditXmlRecord = function (xmlRecordName) {

                viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.annotationLayerLoading);
                viewer.viewerNodes.$annotationLayersDone.prop('disabled', true);
                viewer.viewerNodes.$annotationLayersBack.prop('disabled', true);

                // Create a new layer to add the mark (loaded from XML) to
                var markupLayerCollection = viewer.viewerControl.getMarkupLayerCollection();
                var xmlLayer = new PCCViewer.MarkupLayer(viewer.viewerControl);
                markupLayerCollection.addItem(xmlLayer);
                var previousActiveMarkupLayer = viewer.viewerControl.getActiveMarkupLayer();
                viewer.viewerControl.setActiveMarkupLayer(xmlLayer);
                xmlLayer.setName(xmlRecordName);
                xmlLayer.setOriginalXmlName(xmlRecordName);

                viewer.viewerControl.loadMarkup(xmlRecordName, {
                    retainExistingMarks: true
                }).then(

                    function onResolve() {
                        viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.doneButton);
                        viewer.viewerNodes.$annotationLayersDone.prop('disabled', false);
                        viewer.viewerNodes.$annotationLayersBack.prop('disabled', false);
                        viewer.viewerNodes.$annotationLayersDone.click();
                        loadedEditMarkupLayer = xmlLayer;
                        loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());

                        // Loop through comments and set the owner
                        setLayerCommentsOwner(xmlLayer);
                    },

                    function onReject(reason) {
                        viewer.viewerControl.setActiveMarkupLayer(previousActiveMarkupLayer);
                        xmlLayer.destroy();
                        viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.doneButton);
                        viewer.notify({message: PCCViewer.Language.data.annotationLayerLoadFailed});
                    }

                );
            };

            var loadEditLayerRecord = function (layerRecordId) {

                viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.annotationLayerLoading);
                viewer.viewerNodes.$annotationLayersDone.prop('disabled', true);
                viewer.viewerNodes.$annotationLayersBack.prop('disabled', true);

                var markupLayerCollection = viewer.viewerControl.getMarkupLayerCollection();
                var previousActiveMarkupLayer = viewer.viewerControl.getActiveMarkupLayer();

                var onMarkupLayerAdded = function (ev) {
                    var addedMarkupLayer = markupLayerCollection.getItem(ev.layerId);
                    viewer.viewerControl.setActiveMarkupLayer(addedMarkupLayer);
                };

                markupLayerCollection.on(PCCViewer.MarkupLayerCollection.EventType.MarkupLayerAdded, onMarkupLayerAdded);

                viewer.viewerControl.loadMarkupLayers(layerRecordId).then(

                    function onResolve(annotationLayers) {
                        markupLayerCollection.off(PCCViewer.MarkupLayerCollection.EventType.MarkupLayerAdded, onMarkupLayerAdded);
                        viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.doneButton);
                        viewer.viewerNodes.$annotationLayersDone.prop('disabled', false);
                        viewer.viewerNodes.$annotationLayersBack.prop('disabled', false);
                        viewer.viewerNodes.$annotationLayersDone.click();
                        loadedEditMarkupLayer = annotationLayers[0];
                        loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());

                        commentUIManager.openIfVisibleMarks();
                    },

                    function onReject(reason) {
                        viewer.viewerControl.setActiveMarkupLayer(previousActiveMarkupLayer);
                        markupLayerCollection.off(PCCViewer.MarkupLayerCollection.EventType.MarkupLayerAdded, onMarkupLayerAdded);
                        viewer.viewerNodes.$annotationLayersDone.html(PCCViewer.Language.data.doneButton);
                        viewer.notify({message: PCCViewer.Language.data.annotationLayerLoadFailed});
                    }

                );
            };

            var unloadLayerRecord = function (layerRecordId, done) {

                var layer;

                if (layerRecordId === undefined) {
                    // This layer was loaded from XML and has not been saved.
                    layer = viewer.viewerControl.getActiveMarkupLayer();
                    viewer.viewerControl.deleteMarks(layer.getMarks());
                    delete loadedReviewMarkupXml[layer.getName()];
                    layer.destroy();
                    done(layerRecordId, 'unloadLayerRecord', true);
                    return;
                }
                else if (loadedReviewMarkupLayers[layerRecordId]) {
                    layer = loadedReviewMarkupLayers[layerRecordId];
                } else if (layerRecordId === viewer.viewerControl.getActiveMarkupLayer().getRecordId()) {
                    layer = viewer.viewerControl.getActiveMarkupLayer();
                }

                if (!layer) {
                    return;
                }

                viewer.viewerControl.deleteMarks(layer.getMarks());
                delete loadedReviewMarkupLayers[layerRecordId];
                layer.destroy();
                done(layerRecordId, 'unloadLayerRecord', true);
            };

            // Determines what needs to happen when either the annotation save or load dialogs are displayed.
            var onOpenDialog = function (newIoMode, dialogMode) {

                removeAllOverlays();

                if (newIoMode === this.modes.saveClassic && !saveDialogIsOpen()) {
                    onOpenSaveDialog();
                } else if (newIoMode === this.modes.loadClassic && !loadDialogIsOpen()) {
                    loadMarkupList();

                    if (currentlyLoadedAnnotation) {
                        updateLoadStatusMsg(PCCViewer.Language.data.annotations.load.status + currentlyLoadedAnnotation);
                    } else {
                        updateLoadStatusMsg('');
                    }
                } else if (newIoMode === this.modes.loadMarkupLayers && !loadDialogIsOpen()) {
                    loadAllRecords(dialogMode);
                }

                return true;
            };

            // Attaches listeners for events that cause the displayed annotations to differ from the saved annotation
            // record.
            var annotationModificationListeners = function () {

                var i = 0, modifyingEvents = ['MarkCreated', 'MarkRemoved', 'MarkChanged', 'MarkReordered', 'CommentCreated', 'CommentChanged', 'CommentRemoved'],
                    modHandler = function () {
                        annotationDirty = true;

                        if (saveDialogIsOpen()) {
                            updateSaveMsg();
                            enableSaveForm();
                        }
                    };

                for (i; i < modifyingEvents.length; i++) {
                    viewer.viewerControl.on(modifyingEvents[i], modHandler);
                }
            };

            // After the user inputted file name is validated, the API is called with a request to save the
            // displayed annotations.
            var safeSave = function (filename) {

                filename = filename.replace(/^\s+|\s+$/g, '');

                if (filename.length > 30) {
                    viewer.notify({
                        message: PCCViewer.Language.data.annotations.save.filenameMax
                    });

                    return;
                }

                if (!filename.length) {
                    viewer.notify({
                        message: PCCViewer.Language.data.annotations.save.filenameEmpty
                    });

                    return;
                }

                if (filename === currentlyLoadedAnnotation) {
                    save(filename);
                    return;
                }

                updateSaveMsg(PCCViewer.Language.data.annotations.save.waiting); // language to json
                disableSaveForm();

                viewer.viewerControl.getSavedMarkupNames().then(
                    // success:
                    function (markupRecords) {

                        var duplicate = false, i = 0;

                        for (i; i < markupRecords.length; i++) {

                            if (filename === markupRecords[i].name) {
                                duplicate = true;
                                break;
                            }
                        }

                        if (duplicate) {
                            showOverwriteOverlay();
                        } else {
                            save(filename);
                        }
                    },
                    // failure:
                    function (reason) {
                        viewer.notify({
                            message: PCCViewer.Language.data.annotations.save.failure
                        });
                    });

            };

            // With no validation of the file name, the API is called with a request to save the
            // displayed annotations.
            var save = function (filename) {

                viewer.viewerControl.saveMarkup(filename).then(onSuccessfulSave, onFailedSave);

                currentlyLoadedAnnotation = filename;

                disableSaveForm();

            };

            // This function is called when an annotation is successfully saved to the web tier. It displays a
            // message to the user and also cleans up the UI and resets the annotationDirty flag.
            var onSuccessfulSave = function (filename) {

                viewer.notify({
                    message: PCCViewer.Language.data.annotations.save.success + filename,
                    type: 'success'
                });

                if (saveDialogIsOpen()) {
                    closeSaveDialog();
                }

                removeAllOverlays();

                annotationDirty = false;

            };

            // If an annotation fails to save to the web tier, this function will display a message to the user with
            // associated details.
            var onFailedSave = function (reason) {
                updateSaveMsg(PCCViewer.Language.data.annotations.save.current);
                enableSaveForm();

                viewer.notify({
                    message: PCCViewer.Language.data.annotations.save.failure + PCCViewer.Language.getValue("error." + reason.code)
                });
            };

            // This function will display a dialog to the user warning that a annotation record already exists
            // with the same name as the one being saved. The user will be presented with options and will need
            // to select one to proceed.
            var showOverwriteOverlay = function () {

                if (typeof $overwriteOverlay === 'undefined') {

                    viewer.$dom.append(_.template(options.template.overwriteOverlay)(PCCViewer.Language.data.annotations.save.overwriteOverlay));

                    $overwriteOverlay = viewer.$dom.find('.pcc-annotation-overwrite-dlg');
                    $overlayFade = viewer.$dom.find('.pcc-overlay-fade');

                    $overwriteOverlay.find('.pcc-overlay-closer').on('click', function () {
                        $overwriteOverlay.close();
                        closeSaveDialog();
                    });

                    $overwriteOverlay.close = function () {
                        $overwriteOverlay.hide();
                        $overlayFade.hide();
                    };

                    $overwriteOverlay.mask = function (msg) {

                        if (typeof msg === 'undefined') {
                            $overwriteOverlay.find('.pcc-overlay-mask').show();
                        } else {
                            $overwriteOverlay.find('.pcc-overlay-mask').html(msg).show();
                        }
                    };

                    $overwriteOverlay.unmask = function (msg) {
                        $overwriteOverlay.find('.pcc-overlay-mask').hide();
                    };

                    $overwriteOverlay.on('click', 'li', function (event) {

                        var action = $(this).attr('data-action');

                        overwriteDialogActionsHandler(action);
                    });

                }

                $overwriteOverlay.show();
                $overlayFade.show();

            };

            // The overwrite overlay is a dialog warning that an annotation record already exists
            // with the same name as the one being saved. Once the user selects an action from the dialog,
            // this function will execute the action.
            var overwriteDialogActionsHandler = function (action) {

                switch (action) {

                    case 'save':
                        $overwriteOverlay.mask();
                        save(viewer.viewerNodes.$annotateSaveDialog.find('input').val());
                        break;

                    case 'saveAs':
                        enableSaveForm();
                        $overwriteOverlay.close();
                        var $field = viewer.viewerNodes.$annotateSaveDialog.find('input');
                        $field[0].selectionStart = 0;
                        $field[0].selectionEnd = $field.val().length;
                        $field.focus();
                        updateSaveMsg(PCCViewer.Language.data.annotations.save.as);
                        break;

                    case 'noSave':
                        closeSaveDialog();
                        break;

                    default:
                        break;

                }

            };

            // This function will display a dialog to the user warning that the changes to the displayed annotations
            // have not been saved and might be lost. The user will be presented with options and will need
            // to select one to proceed.
            var showUnsavedChangesOverlay = function () {

                if (typeof $unSavedChangesOverlay === 'undefined') {

                    viewer.$dom.append(_.template(options.template.unsavedChangesOverlay)(PCCViewer.Language.data.annotations.save.unsavedOverlay));

                    $unSavedChangesOverlay = viewer.$dom.find('.pcc-annotation-unsaved-dlg');

                    $overlayFade = viewer.$dom.find('.pcc-overlay-fade');

                    $unSavedChangesOverlay.find('.pcc-overlay-closer').on('click', function () {
                        $unSavedChangesOverlay.close();
                        closeSaveDialog();
                    });

                    $unSavedChangesOverlay.close = function () {
                        $unSavedChangesOverlay.hide();
                        $overlayFade.hide();
                    };

                    $unSavedChangesOverlay.mask = function (msg) {

                        if (typeof msg === 'undefined') {
                            $unSavedChangesOverlay.find('.pcc-overlay-mask').show();
                        } else {
                            $unSavedChangesOverlay.find('.pcc-overlay-mask').html(msg).show();
                        }
                    };

                    $unSavedChangesOverlay.unmask = function (msg) {
                        $unSavedChangesOverlay.find('.pcc-overlay-mask').hide();
                    };

                    $unSavedChangesOverlay.on('click', 'li', function (ev) {

                        var action = $(this).attr('data-action');

                        unsavedChangesActionsHandler(action);
                    });

                }

                $unSavedChangesOverlay.show();

                $overlayFade.show();

            };

            // The unsaved changes overlay is a dialog warning that the changes to the displayed annotations
            // have not been saved and might be lost. Once the user selects an action from the dialog,
            // this function will execute the action.
            var unsavedChangesActionsHandler = function (action) {
                if (typeof currentlyLoadedAnnotation === 'undefined' && action === 'save') {
                    action = 'saveAs';
                }

                switch (action) {
                    case 'save':
                        $unSavedChangesOverlay.mask();
                        save(currentlyLoadedAnnotation);
                        $unSavedChangesOverlay.trigger('saveSelected');
                        break;
                    case 'saveAs':
                        openSaveDialog();
                        $unSavedChangesOverlay.close();
                        var $field = viewer.viewerNodes.$annotateSaveDialog.find('input');
                        $field[0].selectionStart = 0;
                        $field[0].selectionEnd = $field.val().length;
                        $field.focus();
                        updateSaveMsg(PCCViewer.Language.data.annotations.save.as);
                        $unSavedChangesOverlay.trigger('saveAsSelected');
                        break;
                    case 'noSave':
                        $unSavedChangesOverlay.trigger('noSaveSelected');
                        break;
                    default:
                        break;
                }

            };

            // The annotation save dialog's message can be updated using this function.
            var updateSaveMsg = function (msg) {

                if (typeof msg === 'undefined') {
                    if (annotationDirty) {
                        viewer.viewerNodes.$annotateSaveDialog.find('input').val(currentlyLoadedAnnotation);

                        if (currentlyLoadedAnnotation) {
                            msg = PCCViewer.Language.data.annotations.save.current;
                        } else {
                            msg = PCCViewer.Language.data.annotations.save.as;
                        }

                    } else {
                        msg = PCCViewer.Language.data.annotations.save.nomods;
                    }
                }

                viewer.viewerNodes.$annotateSaveDialog.find('.pcc-annotation-save-msg').html(msg).show();
            };

            // A function to determine if the annotation save dialog is open or not.
            var saveDialogIsOpen = function () {
                return viewer.$dom.find('.pcc-icon-save').hasClass('pcc-active');
            };

            // A function that causes the annotation save dialog to open.
            var openSaveDialog = function () {
                if (!saveDialogIsOpen()) {
                    viewer.$dom.find('.pcc-icon-save').first().trigger('click');
                }

                onOpenSaveDialog();
            };

            // Resolve save dialog asynchronously so that any events they depend on are executed first
            var onOpenSaveDialog = function () {
                setTimeout(onOpenSaveDialogAsync, 0);
            };

            // Updates the save dialog when it's first opened.
            var onOpenSaveDialogAsync = function () {
                if (!annotationDirty) {
                    viewer.notify({
                        message: PCCViewer.Language.data.annotations.save.nomods
                    });
                } else {
                    setTimeout(function () {
                        viewer.viewerNodes.$annotateSaveDialog.find('input').focus();
                    }, 100);

                    enableSaveForm();
                }

                updateSaveMsg();
            };

            // A function that causes the annotation save dialog to close.
            var closeSaveDialog = function () {

                viewer.viewerNodes.$annotateSaveDialog.find('input').val('');

                if (saveDialogIsOpen()) {
                    viewer.$dom.find('.pcc-icon-save.pcc-active').first().trigger('click');
                }

                removeAllOverlays();

            };

            // The annotation load dialog's message can be updated using this function.
            var updateLoadMsg = function (msg) {

                viewer.viewerNodes.$annotateLoadDialog.find('.pcc-annotation-load-msg').html(msg).show();
            };

            // The annotation save dialog's status message can be updated using this function.
            var updateLoadStatusMsg = function (msg) {

                viewer.viewerNodes.$annotateLoadDialog.find('.pcc-annotation-load-status-msg').html(msg).show();
            };

            // A function to determine if the annotation load dialog is open or not.
            var loadDialogIsOpen = function () {
                return viewer.$dom.find('.pcc-icon-load').hasClass('pcc-active');
            };

            // Causes all annotation related overlays to be removed.
            var removeAllOverlays = function () {
                if (typeof $overwriteOverlay !== 'undefined' && $overwriteOverlay.is(":visible")) {
                    $overwriteOverlay.unmask();
                    $overwriteOverlay.close();
                }

                if (typeof $unSavedChangesOverlay !== 'undefined' && $unSavedChangesOverlay.is(":visible")) {
                    $unSavedChangesOverlay.unmask();
                    $unSavedChangesOverlay.close();
                }

            };

            // This function disables the annotation save form so the user can't input anything in to it.
            var disableSaveForm = function () {
                viewer.viewerNodes.$annotateSaveDialog.find('input, textarea, button, select').attr('disabled', 'disabled');
            };

            // This function enables the annotation save form so the user can use it.
            var enableSaveForm = function () {
                viewer.viewerNodes.$annotateSaveDialog.find('input, textarea, button, select').removeAttr('disabled');
            };

            // A function that causes the annotation load dialog to close.
            var closeLoadDialog = function () {

                if (loadDialogIsOpen()) {
                    viewer.$dom.find('.pcc-icon-load.pcc-active').first().trigger('click');
                }

            };

            // This function causes the annotation list for loading to be unmasked and user selectable.
            var enableLoadSelect = function () {
                unmaskEl(viewer.viewerNodes.$annotateLoadDropdown);
            };

            // This function causes the annotation list for loading to be masked and unselectable.
            var disableLoadSelect = function (msg) {

                unmaskEl(viewer.viewerNodes.$annotateLoadDropdown);

                if (typeof msg === 'undefined') {
                    msg = PCCViewer.Language.data.annotations.load.waiting;
                }

                maskEl(viewer.viewerNodes.$annotateLoadDropdown, msg);
            };

            // Causes an HTML element to be covered with a mask thus disabling it's functionality for the user.
            var maskEl = function (el, msg) {
                var $parent = $(el).parent();
                var mask = document.createElement('div');
                mask.innerHTML = msg || '';
                mask.className = 'pcc-overlay-mask';
                $parent.append(mask);
                $(mask).show();
            };

            // Causes an HTML element to have it's mask removed thus re-enabling it's functionality for the user.
            var unmaskEl = function (el) {
                var $parent = $(el).parent();
                $parent.find('.pcc-overlay-mask').remove();
            };

            // This function validates user input to the annotation save file name field.
            var handleFilenameInput = function (field, event) {
                var keycode = (event.keyCode ? event.keyCode : event.which),
                    retval = true;

                if (event.shiftKey === true && ( keycode === 189 || keycode === 188 || keycode === 190)) {
                    // don't allow _, <, >
                    retval = false;
                } else if (keycode === 13 || keycode === 9) {

                    viewer.viewerNodes.$annotateSaveDialog.find('button').focus().trigger('click');

                } else {
                    var regex = /[\-a-zA-Z0-9 ]+$/;

                    var input = String.fromCharCode(!event.charCode ? event.which : event.charCode);
                    var numbersOnly = /[0-9]+$/;

                    if (numbersOnly.test(input) && event.shiftKey) {
                        return false;
                    }
                    else if (regex.test(input) || event.keyCode === 8 || event.keyCode === 46 || event.keyCode === 39 || event.keyCode === 37 || (event.which >= 96 && event.which <= 105) || event.keyCode === 173 || event.keyCode === 188 || event.keyCode === 189 || event.keyCode === 109) {
                        return true;
                    }
                    else {
                        return false;
                    }
                }

                return retval;
            };

            function showRecordLoading($container) {
                $container.empty().addClass('pcc-loading-container pcc-icon pcc-icon-loader');
                updateIcon($container);
            }

            function hideRecordLoading($container) {
                $container.empty();
                $container.removeClass('pcc-loading-container pcc-icon pcc-icon-loader');
            }

            var loadAllRecords = function (dialogMode) {
                if (dialogMode === 'review') {
                    viewer.viewerNodes.$annotationLayersDropdown.closest('.pcc-annotation-layer-load-section').addClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayersList.closest('.pcc-annotation-layer-load-section').removeClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayersDone.removeClass('pcc-hide');

                    showRecordLoading( viewer.viewerNodes.$annotationLayersList );
                } else {
                    viewer.viewerNodes.$annotationLayersDropdown.closest('.pcc-annotation-layer-load-section').removeClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayersList.closest('.pcc-annotation-layer-load-section').addClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayersDone.addClass('pcc-hide');

                    showRecordLoading( viewer.viewerNodes.$annotationLayersDropdown );

                    if (loadedEditMarkupLayer) {
                        $('.pcc-select-load-annotation-layers .pcc-label').text(loadedEditMarkupLayer.getName());
                    }
                }

                // Request the XML markup names and then request the markup layer names.
                viewer.viewerControl.getSavedMarkupNames().then(
                    // success:
                    function (markups) {
                        loadMarkupLayerRecords(dialogMode, markups);
                    },
                    // failure:
                    function (reason) {
                        if (dialogMode === 'review') {
                            hideRecordLoading(viewer.viewerNodes.$annotationLayersList);
                        } else {
                            hideRecordLoading(viewer.viewerNodes.$annotationLayersDropdown);
                        }

                        //skip notify dialog if the license error occurs
                        if (reason && reason.code === "LicenseCouldNotBeVerified")
                            return;

                        //closeLoadDialog();
                        viewer.notify({
                            message: PCCViewer.Language.data.annotations.load.listFailure
                        });
                    });
            };

            // This function executes an API request to fetch the list of annotation records associated with the
            // loaded document.
            var loadMarkupList = function () {
                updateLoadMsg(PCCViewer.Language.data.annotations.load.waiting);
                disableLoadSelect('');

                viewer.viewerNodes.$annotationList.empty();

                viewer.viewerControl.getSavedMarkupNames().then(
                    // success:
                    function (markups) {

                        var markupRecordTpl, markupRecord, record, domStrings = [], i = 0;

                        markupRecordTpl = '<div class="pcc-row" data-pcc-markup-record-id="{{ID}}">{{NAME}}</div>';

                        for (i; i < markups.length; i++) {

                            record = markups[i];

                            markupRecords[record.name] = record;

                            markupRecord = markupRecordTpl.replace('{{ID}}', record.name)
                                .replace('{{NAME}}', record.name);

                            domStrings.push(markupRecord);
                        }

                        if (domStrings.length) {
                            viewer.viewerNodes.$annotationList.append(domStrings.join('\n'))
                                .find('.pcc-row:odd').addClass('pcc-odd');

                            updateLoadMsg(PCCViewer.Language.data.annotations.load.instructions);
                            enableLoadSelect();

                        } else {

                            viewer.notify({
                                message: PCCViewer.Language.data.annotations.load.emptyList
                            });

                            updateLoadMsg(PCCViewer.Language.data.annotations.load.emptyList);
                            disableLoadSelect('');

                        }

                    },
                    // failure:
                    function (reason) {
                        closeLoadDialog();
                        viewer.notify({
                            message: PCCViewer.Language.data.annotations.load.listFailure
                        });
                    });
            };

            var loadMarkupLayerRecords = function (dialogMode, xmlRecords) {
                viewer.viewerControl.requestMarkupLayerNames().then(

                    function onResolve(annotationLayerRecords){

                        var $loadMsg = viewer.viewerNodes.$annotationLayersLoadDialog.find('.pcc-annotation-layers-load-msg');

                        if (annotationLayerRecords.length || xmlRecords.length) {
                            $loadMsg.html('');

                        } else {
                            viewer.notify({message: PCCViewer.Language.data.annotationLayersEmptyList});
                            $loadMsg.html(PCCViewer.Language.data.annotationLayersEmptyList);
                        }

                        if (dialogMode === 'review') {
                            hideRecordLoading(viewer.viewerNodes.$annotationLayersList);
                            populateLayerRecordsList(annotationLayerRecords, viewer.viewerNodes.$annotationLayersList, xmlRecords);
                        } else {
                            hideRecordLoading(viewer.viewerNodes.$annotationLayersDropdown);
                            populateLayerRecordsDropdown(annotationLayerRecords, viewer.viewerNodes.$annotationLayersDropdown, xmlRecords);
                        }
                    },

                    function onReject(reason) {
                        if (dialogMode === 'review') {
                            hideRecordLoading(viewer.viewerNodes.$annotationLayersList);
                        } else {
                            hideRecordLoading(viewer.viewerNodes.$annotationLayersDropdown);
                        }

                        viewer.notify({message: PCCViewer.Language.data.annotationLayersListLoadFailed});
                    }
                );
            };

            var populateLayerRecordsList = function (annotationLayerRecords, $container, xmlRecords) {
                var fragment = document.createDocumentFragment();

                $container.empty();

                var allRecordDivs = [];

                _.forEach(annotationLayerRecords, function(annotationLayerRecord, index) {

                    // Do not include an XML record name in the list if any markup layer's original XML name is set to the XML record name
                    xmlRecords = $.grep(xmlRecords, function(xmlRecord) {
                        return xmlRecord.name !== annotationLayerRecord.originalXmlName;
                    });

                    // Don't show already loaded layers
                    if (loadedEditMarkupLayer && loadedEditMarkupLayer.getRecordId() === annotationLayerRecord.layerRecordId) {
                        return;
                    }

                    var divClassName = 'pcc-annotation-layer-record pcc-row',
                        div = resultView.elem('div', { className: divClassName }),
                        checkbox = resultView.elem('span', { className: 'pcc-checkbox pcc-col-2' }),
                        icon = resultView.elem('span', { className: 'pcc-icon pcc-icon-check' }),
                        loading = resultView.elem('span', { className: 'pcc-load pcc-hide pcc-col-2' }),
                        text = resultView.elem('span', { className: 'pcc-annotation-layer-name pcc-col-10', text: annotationLayerRecord.name });

                    $(div).attr('data-pcc-annotation-layer-record-id', annotationLayerRecord.layerRecordId);
                    checkbox.appendChild(icon);
                    div.appendChild(checkbox);
                    div.appendChild(loading);
                    div.appendChild(text);

                    if (loadedReviewMarkupLayers[annotationLayerRecord.layerRecordId] && loadedReviewMarkupLayers[annotationLayerRecord.layerRecordId].getSessionData('Accusoft-state') !== 'merged') {
                        $(div).addClass('pcc-checked');
                    }

                    parseIcons($(div));

                    allRecordDivs.push({name: annotationLayerRecord.name, div: div});
                });

                _.forEach(xmlRecords, function(xmlRecord, index) {
                    // Don't show already loaded layers
                    if (loadedEditMarkupLayer && loadedEditMarkupLayer.getOriginalXmlName() === xmlRecord.name) {
                        return;
                    }

                    var divClassName = 'pcc-annotation-layer-record pcc-row',
                        div = resultView.elem('div', { className: divClassName }),
                        checkbox = resultView.elem('span', { className: 'pcc-checkbox pcc-col-2' }),
                        loading = resultView.elem('span', { className: 'pcc-load pcc-hide pcc-col-2' }),
                        text = resultView.elem('span', { className: 'pcc-annotation-layer-name pcc-col-10', text: xmlRecord.name });

                    $(div).attr('data-pcc-annotation-xml-record-id', xmlRecord.name);
                    div.appendChild(checkbox);
                    div.appendChild(loading);
                    div.appendChild(text);

                    if (loadedReviewMarkupXml[xmlRecord.name] && loadedReviewMarkupXml[xmlRecord.name].getSessionData('Accusoft-state') !== 'merged') {
                        $(div).addClass('pcc-checked');
                    }

                    allRecordDivs.push({ name: xmlRecord.name, div: div });
                });

                // Sort the layers by name.
                allRecordDivs = allRecordDivs.sort(function (a, b) {
                    var aName = a.name.toLowerCase();
                    var bName = b.name.toLowerCase();
                    return aName === bName ? 0 : aName > bName ? 1 : -1;
                });

                _.forEach(allRecordDivs, function(recordDiv, index) {
                    fragment.appendChild(recordDiv.div);
                });

                if (allRecordDivs.length) {
                    // only add a "toggle all" option if there are layers
                    toggleAllReviewLayers = ToggleAllControl('pcc-toggle-all pcc-row', function(state){

                        if ($(toggleAllReviewLayers).data('pcc-loading') === 'true') {
                            return;
                        }

                        var $node;
                        $container.find('.pcc-annotation-layer-record').each(function(idx, node){

                            $node = $(node);

                            if (state === 'checked' && !$node.hasClass('pcc-checked')) {
                                $(toggleAllReviewLayers).data('pcc-loading', 'true');

                                var $loader =  $(toggleAllReviewLayers).find('.pcc-load');

                                if (!$loader.length) {
                                    var loaderEl = document.createElement('span');
                                    loaderEl.className = 'pcc-load pcc-col-2';
                                    $loader = $(toggleAllReviewLayers).prepend(loaderEl);
                                }

                                $(toggleAllReviewLayers).find('.pcc-checkbox').hide();
                                $loader.show();

                                $node.click();
                            } else if (state === 'unchecked' && $node.hasClass('pcc-checked')){


                                $node.click();
                            }

                            $node = undefined;
                        });
                    });

                    $container.append(toggleAllReviewLayers);

                }

                $container.append(fragment);
            };

            var populateLayerRecordsDropdown = function (annotationLayerRecords, $container, xmlRecords) {
                var fragment = document.createDocumentFragment(),
                    allRecordDivs = [];

                $container.empty();

                // Include annotation markup layer records in the dropdown
                _.forEach(annotationLayerRecords, function(annotationLayerRecord, index) {
                    // Do not include an XML record name in the dropdown if any markup layer's original XML name is set to the XML record name
                    xmlRecords = $.grep(xmlRecords, function(xmlRecord) {
                        return xmlRecord.name !== annotationLayerRecord.originalXmlName;
                    });

                    // Don't show already loaded layers
                    if (typeof loadedReviewMarkupLayers[annotationLayerRecord.layerRecordId] !== 'undefined') {
                        return;
                    }

                    var divClassName = 'pcc-annotation-layer-record pcc-row',
                        div = resultView.elem('div', { className: divClassName }),
                        text = resultView.elem('span', { className: 'pcc-annotation-layer-name pcc-row', text: annotationLayerRecord.name });

                    div.appendChild(text);
                    $(div).attr('data-pcc-annotation-layer-record-id', annotationLayerRecord.layerRecordId).find('.pcc-row:odd').addClass('pcc-odd');

                    allRecordDivs.push({name: annotationLayerRecord.name, div: div});
                });

                // Include XML markup records in the dropdown
                _.forEach(xmlRecords, function(xmlRecord, index) {
                    // Don't show already loaded layers
                    if (typeof loadedReviewMarkupXml[xmlRecord.name] !== 'undefined') {
                        return;
                    }

                    var divClassName = 'pcc-annotation-layer-record pcc-row',
                        div = resultView.elem('div', { className: divClassName }),
                        text = resultView.elem('span', { className: 'pcc-annotation-layer-name pcc-row', text: xmlRecord.name });

                    div.appendChild(text);
                    $(div).attr('data-pcc-annotation-xml-record-id', xmlRecord.name).find('.pcc-row:odd').addClass('pcc-odd');

                    allRecordDivs.push({name: xmlRecord.name, div: div});
                });

                // Sort the layers by name.
                allRecordDivs = allRecordDivs.sort(function (a, b) {
                    var aName = a.name.toLowerCase();
                    var bName = b.name.toLowerCase();
                    return aName === bName ? 0 : aName > bName ? 1 : -1;
                });

                _.forEach(allRecordDivs, function(recordDiv, index) {
                    fragment.appendChild(recordDiv.div);
                });

                $container.append(fragment);

            };

            // This function executes an API request to load a specific annotation record.
            var loadMarkupRecord = function (record) {

                updateLoadMsg(PCCViewer.Language.data.annotations.load.waiting);
                disableLoadSelect('');

                viewer.viewerControl.loadMarkup(record.name).then(
                    // success:
                    function (markupRecord) {
                        closeLoadDialog();
                        viewer.setMouseTool({ mouseToolName: 'AccusoftPanAndEdit' });
                        currentlyLoadedAnnotation = markupRecord;
                        annotationDirty = false;
                        if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }

                        if (typeof markupRecord.getData('Accusoft-owner') === 'undefined') {
                            markupRecord.setData('Accusoft-owner', markupRecord.getName());
                        }
                    },
                    // failure:
                    function (reason) {
                        closeLoadDialog();
                        viewer.notify({
                            message: PCCViewer.Language.data.annotations.load.recordFailure
                        });
                    }
                );
            };

            // This function listens for user selection of an annotation record from a displayed list. It then attempts
            // to load that record.
            var handleLoadSelection = function (resultRow) {

                var record = markupRecords[resultRow.getAttribute('data-pcc-markup-record-id')];

                if (annotationDirty) {

                    showUnsavedChangesOverlay();

                    $unSavedChangesOverlay.one('noSaveSelected', function () {
                        loadMarkupRecord(record);
                    });

                    if (currentlyLoadedAnnotation) {
                        $unSavedChangesOverlay.one('saveSelected', function () {
                            closeLoadDialog();
                        });
                    }

                    return false;
                }

                loadMarkupRecord(record);

            };

            function disableAllLayerMarks(layer) {
                _.forEach(layer.getMarks(), function(mark) {
                    // Store the original interaction mode in the mark's data so it can be restored later if the layer is merged to the current layer.
                    // Note that it is necessary to use the setData method here instead of the setSessionData method because the copyLayers method
                    // might be used later and it does not copy session data. It is okay to use the setData method in this case since the viewer
                    // never saves marks that are loaded for review.
                    var originalInteractionMode = mark.getInteractionMode();
                    mark.setData('Accusoft-originalInteractionMode', originalInteractionMode);
                    mark.setInteractionMode(PCCViewer.Mark.InteractionMode.SelectionDisabled);
                });
            }

            function autoLoadAllLayers(done) {
                var viewerControl = viewer.viewerControl;
                var loadWithErrors = false;

                function resolveLoad() {
                    if (loadWithErrors) {
                        viewer.notify({
                            message: PCCViewer.Language.data.annotationLayerAutoLoadError
                        });
                    }
                }

                PCCViewer.Promise.all([
                    viewerControl.requestMarkupLayerNames(),
                    viewerControl.getSavedMarkupNames()
                ]).then(function(args) {
                    var layerNames = args[0];
                    var xmlNames = args[1];
                    var editableLayerLoaded = false;

                    // create a list of promises to resolve
                    var layerLoadPromises = [];

                    // find all layerRecordIds that we need to load
                    var layerIds = _.map(layerNames, function(layer){
                        return layer.layerRecordId;
                    });

                    if (layerIds.length) {
                        // load all layer records
                        var jsonLayerPromise = viewerControl.loadMarkupLayers(layerIds, {
                            loadAsHidden: true
                        });
                        layerLoadPromises.push( jsonLayerPromise );

                        // when loaded, keep track of them
                        jsonLayerPromise.then(function(loadedLayers){
                            _.forEach(loadedLayers, function(loadedLayer) {
                                // If the editable layer source is XML, check the original XML name of the layer.
                                var loadOriginalXmlLayerFromJson = typeof viewer.viewerControlOptions.editableMarkupLayerSource === 'string' && viewer.viewerControlOptions.editableMarkupLayerSource.toLowerCase() === 'xmlname' && typeof viewer.viewerControlOptions.editableMarkupLayerValue === 'string' && viewer.viewerControlOptions.editableMarkupLayerValue === loadedLayer.getOriginalXmlName();

                                // store each layer in the loaded layers object
                                var loadEditableLayer = typeof viewer.viewerControlOptions.editableMarkupLayerSource === 'string' && viewer.viewerControlOptions.editableMarkupLayerSource.toLowerCase() === 'layerrecordid';
                                if (loadOriginalXmlLayerFromJson !== true && (loadEditableLayer !== true || loadedLayer.getRecordId() !== viewer.viewerControlOptions.editableMarkupLayerValue)) {
                                    loadedReviewMarkupLayers[loadedLayer.getRecordId()] = loadedLayer;
                                    loadedLayer.hide();
                                    loadedLayer.setSessionData('Accusoft-visibility', 'hidden');
                                    disableAllLayerMarks(loadedLayer);
                                }
                                else {
                                    // Set this layer as the editable layer
                                    editableLayerLoaded = true;
                                    loadedEditMarkupLayer = loadedLayer;
                                    viewerControl.getActiveMarkupLayer().destroy();
                                    viewerControl.setActiveMarkupLayer(loadedLayer);
                                    loadedLayer.show();
                                    loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());
                                }
                            });
                        }, function(reason) {
                            loadWithErrors = true;
                        });
                    }

                    // get all of the XML layer names that we need to load
                    var filteredXmlNames = _.chain(xmlNames).map(function(xml){
                        return xml.name;
                    }).filter(function(xmlName){
                        // remove XML names that already exist as JSON layers
                        return !_.find(layerNames, function(layer) {
                            return layer.originalXmlName === xmlName;
                        });
                    }).value();

                    _.forEach(filteredXmlNames, function(xmlName){
                        // create a layer to store each XML record
                        var xmlLayer = new PCCViewer.MarkupLayer(viewerControl);
                        viewerControl.getMarkupLayerCollection().addItem(xmlLayer);
                        xmlLayer.setName(xmlName);
                        xmlLayer.setOriginalXmlName(xmlName);

                        // create a wrapper promise
                        var deferred = PCCViewer.Deferred();
                        var promise = deferred.getPromise();

                        // load the XML record
                        viewerControl.loadMarkup(xmlName, {
                            retainExistingMarks: true,
                            markupLayer: xmlLayer,
                            loadAsHidden: true
                        }).then(function() {
                            // store layer in the loaded layers object
                            var loadEditableLayerFromXml = typeof viewer.viewerControlOptions.editableMarkupLayerSource === 'string' && viewer.viewerControlOptions.editableMarkupLayerSource.toLowerCase() === 'xmlname';
                            if (loadEditableLayerFromXml !== true || xmlLayer.getName() !== viewer.viewerControlOptions.editableMarkupLayerValue) {
                                loadedReviewMarkupXml[xmlName] = xmlLayer;
                                xmlLayer.hide();
                                xmlLayer.setSessionData('Accusoft-visibility', 'hidden');
                                disableAllLayerMarks(xmlLayer);
                            }
                            else {
                                // Set this layer as the editable layer
                                editableLayerLoaded = true;
                                loadedEditMarkupLayer = xmlLayer;
                                viewerControl.getActiveMarkupLayer().destroy();
                                viewerControl.setActiveMarkupLayer(xmlLayer);
                                xmlLayer.show();
                                loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());
                            }

                            // Loop through comments and set the owner
                            setLayerCommentsOwner(xmlLayer);

                            deferred.resolve();
                        }, function() {
                            loadWithErrors = true;
                            // do some cleanup
                            viewerControl.getMarkupLayerCollection().removeItem(xmlLayer.getId());
                            deferred.resolve();
                        });

                        // add the parent promise to the group of promises to resolve
                        layerLoadPromises.push( promise );
                    });

                    // resolve all promises together, so we know when we are done loading
                    PCCViewer.Promise.all(layerLoadPromises).then(function(){

                        // check if we need to set a layer as editable
                        var editableLayerSource = viewer.viewerControlOptions.editableMarkupLayerSource.toString().toLowerCase();
                        var editableLayerValue = viewer.viewerControlOptions.editableMarkupLayerValue;

                        var stillNeedToLoadEditableLayer = (editableLayerSource && editableLayerValue) && !editableLayerLoaded;

                        function onDone(err) {
                            resolveLoad();
                            done(err);
                        }

                        if (stillNeedToLoadEditableLayer) {
                            // The layer that was configured to be loaded was not loaded
                            // above. This likely means that it was not part of the abailable
                            // list, likely because the list was overloaded on the server to
                            // return an interesting subset instead of all available layers.
                            // We should attempt to load the requested layer anyway.
                            if (editableLayerSource === 'layerrecordid') {
                                autoLoadEditableLayer(editableLayerValue, onDone);
                            } else if (editableLayerSource === 'xmlname') {
                                autoLoadEditableXml(editableLayerValue, onDone);
                            } else {
                                onDone();
                            }
                        } else {
                            onDone();
                        }
                    }, function(reason) {
                        loadWithErrors = true;
                        resolveLoad();
                        done(reason);
                    });
                }, function(reason) {
                    loadWithErrors = true;
                    resolveLoad();
                    done(reason);
                });
            }

            function autoLoadEditableLayer(layerRecordId, done) {
                done = (typeof done === 'function') ? done : function noop() {};

                // Load the JSON markup layer
                viewer.viewerControl.loadMarkupLayers(layerRecordId).then(function onResolve(annotationLayers) {
                    // Set this layer as the editable layer
                    loadedEditMarkupLayer = annotationLayers[0];
                    viewer.viewerControl.getActiveMarkupLayer().destroy();
                    viewer.viewerControl.setActiveMarkupLayer(loadedEditMarkupLayer);
                    loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());

                    done();
                }, function onErrored(reason) {
                    done(reason);
                });
            }

            function autoLoadEditableXml(xmlName, done) {
                done = (typeof done === 'function') ? done : function noop() {};

                // Check the original XML name of the layer
                var loadFromXml = true;

                viewer.viewerControl.requestMarkupLayerNames().then(function(layerNames) {
                    _.forEach(layerNames, function (layerName) {
                        if (xmlName === layerName.originalXmlName) {
                            // Load this layer as the editable layer
                            viewer.viewerControl.loadMarkupLayers(layerName.layerRecordId).then(function onResolve(annotationLayers) {
                                // Set this layer as the editable layer
                                loadedEditMarkupLayer = annotationLayers[0];
                                viewer.viewerControl.getActiveMarkupLayer().destroy();
                                viewer.viewerControl.setActiveMarkupLayer(loadedEditMarkupLayer);
                                loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());
                            });
                            loadFromXml = false;
                        }
                    });

                    if (loadFromXml === false) {
                        return done();
                    }

                    // Load the XML layer from XML
                    viewer.viewerControl.loadMarkup(xmlName).then(function() {
                        var xmlLayer = viewer.viewerControl.getActiveMarkupLayer();
                        xmlLayer.setName(xmlName);
                        xmlLayer.setOriginalXmlName(xmlName);

                        loadedEditMarkupLayer = xmlLayer;
                        loadedEditMarkupLayer.setSessionData('Accusoft-savedLayerName', loadedEditMarkupLayer.getName());

                        // Loop through comments and set the owner
                        setLayerCommentsOwner(xmlLayer);

                        done();
                    }, function onErrored(reason) {
                        done(reason);
                    });
                }, function onErrored(reason) {
                    done(reason);
                });
            }

            // The publicly accessible members of this module.
            return {
                init: init,
                refresh: refresh,
                onOpenDialog: onOpenDialog,
                modes: modes,
                autoLoadAllLayers: autoLoadAllLayers,
                autoLoadEditableLayer: autoLoadEditableLayer,
                autoLoadEditableXml: autoLoadEditableXml
            };

        })();

        // The annotationLayerReview module manages the annotation layers in the viewer, such as setting which
        // layers are visible or merging layers.
        this.annotationLayerReview = (function () {

            // The editable layer for the current user.
            var currentLayer;

            // Initialize the module by attaching UI event handlers and by attaching listeners for events that
            // modify annotation layers.
            var init = function () {
                bindAnnotationLayerReviewDOM();
            };

            var mergeMode = function (mode) {
                var $reviewLayers = $('[data-pcc-annotation-layer-review-section=other] .pcc-annotation-layer-review-section-content .pcc-row');

                $reviewLayers.removeClass('pcc-checked');
                viewer.viewerNodes.$annotationLayerMerge.attr('disabled', true);

                if ($reviewLayers.length === 0) {
                    viewer.viewerNodes.$annotationLayerShowAll.attr('disabled', true);
                    viewer.viewerNodes.$annotationLayerHideAll.attr('disabled', true);
                    viewer.viewerNodes.$annotationLayerMergeAll.attr('disabled', true);
                    viewer.viewerNodes.$annotationLayerMergeMode.attr('disabled', true);
                } else {
                    viewer.viewerNodes.$annotationLayerShowAll.attr('disabled', false);
                    viewer.viewerNodes.$annotationLayerHideAll.attr('disabled', false);
                    viewer.viewerNodes.$annotationLayerMergeAll.attr('disabled', false);
                    viewer.viewerNodes.$annotationLayerMergeMode.attr('disabled', false);
                }

                if (mode === 'off' || $reviewLayers.length === 0) {
                    $reviewLayers.filter('.pcc-toggle-all').addClass('pcc-hide');
                    $reviewLayers.not('.pcc-toggle-all').find('.pcc-checkbox').addClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayerMergeActions.addClass('pcc-hide');
                } else if (mode === 'on') {
                    $reviewLayers.filter('.pcc-toggle-all').removeClass('pcc-hide');
                    $reviewLayers.not('.pcc-toggle-all').find('.pcc-checkbox').removeClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayerMergeActions.removeClass('pcc-hide');
                } else {
                    $reviewLayers.filter('.pcc-toggle-all').toggleClass('pcc-hide');
                    $reviewLayers.not('.pcc-toggle-all').find('.pcc-checkbox').toggleClass('pcc-hide');
                    viewer.viewerNodes.$annotationLayerMergeActions.toggleClass('pcc-hide');
                }

                edgeForceRepaintWorkaround(viewer.viewerNodes.$annotationLayerMergeActions);
            };

            var bindAnnotationLayerReviewDOM = function () {

                // Toggle merge mode on or off
                viewer.viewerNodes.$annotationLayerMergeMode.on('click', function() {
                    mergeMode();
                });

                // Cancel merging
                viewer.viewerNodes.$annotationLayerMergeCancel.on('click', function() {
                    mergeMode('off');
                });

                function mergeMarkupLayers(markupLayers, onMerged, onError) {
                    var $annotationLayerElements = $('.pcc-annotation-layer-review-other');

                    mergeMode('off');

                    var uniquePages = _.chain(markupLayers)
                        .map(function (layer) { return layer.getMarks(); })
                        .flatten()
                        .map(function (mark) { return mark.getPageNumber(); })
                        .uniq()
                        .value();
                    var pageAttributePromises = _.map(uniquePages, viewer.viewerControl.requestPageAttributes, viewer.viewerControl);
                    PCCViewer.Promise.all(pageAttributePromises).then(
                        function onFulfilled() {
                            currentLayer.copyLayers(markupLayers);

                            // Loop through the marks on the current layer and restore their interaction mode
                            // to unlock the copied marks that were originally unlocked.
                            _.forEach(currentLayer.getMarks(), function (mark) {
                                var originalInteractionMode = mark.getData('Accusoft-originalInteractionMode');

                                if (originalInteractionMode !== undefined) {
                                    mark.setInteractionMode(originalInteractionMode);
                                    mark.setData('Accusoft-originalInteractionMode', undefined);
                                }
                            });

                            _.forEach(markupLayers, function (markupLayer) {

                                // Remove the item from the review panel
                                $annotationLayerElements.filter('[data-pcc-other-layer="' + markupLayer.getId() + '"]').remove();

                                viewer.viewerControl.deleteMarks(markupLayer.getMarks());
                                markupLayer.destroy();
                                markupLayer.setSessionData('Accusoft-state', 'merged');
                            });

                            $annotationLayerElements = $('.pcc-annotation-layer-review-other');
                            if ($annotationLayerElements.length === 0) {
                                var text = createElem('div', 'pcc-annotation-layer-review-other');
                                text.appendChild(document.createTextNode(PCCViewer.Language.data.annotationLayerReview.noAnnotationsForReview));
                                $('[data-pcc-annotation-layer-review-section=other] .pcc-annotation-layer-review-section-content').append(text);

                                viewer.viewerNodes.$annotationLayerShowAll.attr('disabled', true);
                                viewer.viewerNodes.$annotationLayerHideAll.attr('disabled', true);
                                viewer.viewerNodes.$annotationLayerMergeMode.attr('disabled', true);
                                viewer.viewerNodes.$annotationLayerMergeAll.attr('disabled', true);
                            }

                            onMerged();
                        },
                        onError);
                }

                // Merge selected layers onto the currently editable layer
                viewer.viewerNodes.$annotationLayerMerge.on('click', function() {

                    // Loop through the the list of layer DOM elements and get the layer IDs that are stored on each DOM element, for any checked items.
                    var annotationLayerElements = $('.pcc-annotation-layer-review-other.pcc-checked');

                    var checkedMarkupLayers = _.map(annotationLayerElements, function(el) {
                        var layer = el.getAttribute('data-pcc-other-layer');
                        return viewer.viewerControl.getMarkupLayerCollection().getItem(layer);
                    });

                    mergeMarkupLayers(checkedMarkupLayers,
                        function onMerged() {
                            viewer.notify({
                                message: PCCViewer.Language.data.annotationLayerReview.mergeLayerSuccess,
                                type: 'success'
                            });
                        },
                        function onError() {
                            viewer.notify({
                                message: PCCViewer.Language.data.annotationLayerReview.mergeLayerError
                            });
                        });
                });

                // Merge all layers onto the currently editable layer
                viewer.viewerNodes.$annotationLayerMergeAll.on('click', function() {

                    // Loop through the the list of layer DOM elements and get the layer IDs that are stored on each DOM element.
                    var annotationLayerElements = $('.pcc-annotation-layer-review-other');

                    var markupLayers = _.map(annotationLayerElements, function(el) {
                        var layer = el.getAttribute('data-pcc-other-layer');
                        return viewer.viewerControl.getMarkupLayerCollection().getItem(layer);
                    });

                    mergeMarkupLayers(markupLayers);

                    viewer.notify({
                        message: PCCViewer.Language.data.annotationLayerReview.mergeAllLayerSuccess,
                        type: 'success'
                    });
                });

                viewer.viewerNodes.$annotationLayerShowAll.on('click', function() {
                    var annotationLayerElements = $('.pcc-annotation-layer-review-other');

                    _.forEach(annotationLayerElements, function(annotationLayerElement) {
                        var layerId = annotationLayerElement.getAttribute('data-pcc-other-layer');
                        var target = $(annotationLayerElement).find('.pcc-icon-eye-closed');
                        showClickGeneric(layerId, target);
                    });
                });

                viewer.viewerNodes.$annotationLayerHideAll.on('click', function() {
                    var annotationLayerElements = $('.pcc-annotation-layer-review-other');

                    _.forEach(annotationLayerElements, function(annotationLayerElement) {
                        var layerId = annotationLayerElement.getAttribute('data-pcc-other-layer');
                        var target = $(annotationLayerElement).find('.pcc-icon-eye');
                        hideClickGeneric(layerId, target);
                    });
                });

            };

            var refresh = function() {
                var allMarkupLayers = viewer.viewerControl.getMarkupLayerCollection().getAll();
                var currentMarkupLayer = viewer.viewerControl.getActiveMarkupLayer();
                var otherMarkupLayers = _.filter(allMarkupLayers, function(markupLayer) {
                    return (markupLayer.getId() !== currentMarkupLayer.getId()) && (markupLayer.getSessionData('Accusoft-state') !== 'merged');
                });
                onOpenDialog(currentMarkupLayer, otherMarkupLayers);
            };

            // Determines what needs to happen when the annotation layer controller dialog is opened.
            var onOpenDialog = function (currentMarkupLayer, otherMarkupLayers) {
                currentLayer = currentMarkupLayer;

                populateCurrentMarkupLayer(currentLayer, $('[data-pcc-annotation-layer-review-section=current] .pcc-annotation-layer-review-section-content'), 'current');

                var $container = $('[data-pcc-annotation-layer-review-section=other] .pcc-annotation-layer-review-section-content');

                if (otherMarkupLayers.length === 0) {
                    $container.empty();
                    var text = createElem('div', 'pcc-annotation-layer-review-other');
                    text.appendChild(document.createTextNode(PCCViewer.Language.data.annotationLayerReview.noAnnotationsForReview));
                    $container.append(text);
                } else {
                    populateMarkupLayers(otherMarkupLayers, $container, 'other');
                }
                mergeMode('off');
            };

            var showClickAction = function(event) {
                var layerId = event.data.layerId;
                showClickGeneric(layerId, $(this));
            };

            var hideClickAction = function(event) {
                var layerId = event.data.layerId;
                hideClickGeneric(layerId, $(this));
                $(this).off('click', hideClickAction);
            };

            var showClickGeneric = function(layerId, $target) {
                var layer = viewer.viewerControl.getMarkupLayerCollection().getItem(layerId);
                layer.show();
                layer.setSessionData('Accusoft-visibility', 'visible');

                var replacement = createElem('span', 'pcc-icon pcc-icon-eye pcc-pull-right');
                replacement.setAttribute('title', PCCViewer.Language.data.annotationLayerReview.hide);
                $target.replaceWith(replacement);
                $(replacement).on('click', {layerId: layerId}, hideClickAction);
                updateIcon($(replacement));
                fileDownloadManager.enableAvailableMarkOptions();
            };

            var hideClickGeneric = function(layerId, $target) {
                var layer = viewer.viewerControl.getMarkupLayerCollection().getItem(layerId);
                layer.hide();
                layer.setSessionData('Accusoft-visibility', 'hidden');

                var replacement = createElem('span', 'pcc-icon pcc-icon-eye-closed pcc-pull-right');
                replacement.setAttribute('title', PCCViewer.Language.data.annotationLayerReview.show);
                $target.replaceWith(replacement);
                $(replacement).on('click', {layerId: layerId}, showClickAction);
                updateIcon($(replacement));
                fileDownloadManager.enableAvailableMarkOptions();
            };

            var editClickAction = function(event) {
                var layerId = event.data.layerId,
                    layer = viewer.viewerControl.getMarkupLayerCollection().getItem(layerId),
                    layerNameClass = 'pcc-current-layer-name',
                    $layerName = viewer.$dom.find('.' + layerNameClass),
                    elem;

                if ($layerName[0].nodeName.toLowerCase() === 'input') {
                    elem = createElem('span', layerNameClass + ' pcc-pull-left');
                    elem.appendChild(document.createTextNode(layer.getName() || PCCViewer.Language.data.annotationLayerReview.unnamed));
                } else {
                    elem = createElem('input', layerNameClass + ' pcc-pull-left');
                    elem.setAttribute('value', $layerName.text());
                    elem.setAttribute('placeholder', PCCViewer.Language.data.annotationLayerReview.unnamed);

                    $(elem).on('keypress', function(e) {

                        if (e.keyCode === 13) {
                            // Necessary to avoid IE10 issue where pressing enter causes a button to be clicked
                            e.preventDefault();

                            $(this).blur();
                        }
                    });

                    $(elem).on('blur', function(e) {
                        var value = $(this).val();

                        if (value) {
                            layer.setName(value);
                        }

                        // Toggle this method with the original event
                        editClickAction(event);
                    });
                }

                $(elem).replaceAll($layerName).focus().select();
            };

            var populateCurrentMarkupLayer = function(annotationLayer, $container, classFragment) {
                $container.empty();

                // Create the container
                var divClassName = 'pcc-annotation-layer-review-' + classFragment + ' pcc-' + classFragment + '-layer pcc-checked pcc-row',
                    div = createElem('div', divClassName),
                    text = createElem('span', 'pcc-' + classFragment + '-layer-name pcc-pull-left');

                text.appendChild(document.createTextNode(annotationLayer.getName() || PCCViewer.Language.data.annotationLayerReview.unnamed));
                div.setAttribute('data-pcc-' + classFragment + '-layer', annotationLayer.getId());
                div.appendChild(text);

                // Display the markup layer.
                var isHidden = annotationLayer.getSessionData('Accusoft-visibility') === 'hidden';
                var visibilityIcon;
                var visibilityTooltip;
                var visibilityAction;
                if (isHidden) {
                    visibilityIcon = 'pcc-icon-eye-closed';
                    visibilityTooltip = PCCViewer.Language.data.annotationLayerReview.show;
                    visibilityAction = showClickAction;
                }
                else {
                    visibilityIcon = 'pcc-icon-eye';
                    visibilityTooltip = PCCViewer.Language.data.annotationLayerReview.hide;
                    visibilityAction = hideClickAction;
                }

                // Toggle visibility
                var visibilityToggle = createElem('span', 'pcc-icon ' + visibilityIcon + ' pcc-pull-right');

                updateIcon($(visibilityToggle));
                visibilityToggle.setAttribute('title', visibilityTooltip);
                $(visibilityToggle).on('click', { layerId: annotationLayer.getId()}, visibilityAction);
                div.appendChild(visibilityToggle);

                // Activate the edit button
                $('[data-pcc-annotation-layer-edit="current"]').off().on('click', { layerId: annotationLayer.getId() }, editClickAction);

                $container.append(div);
            };

            var populateMarkupLayers = function(annotationLayers, $container, classFragment) {
                var checkboxClickAction = function(div){
                    $(div).toggleClass('pcc-checked');
                    // Disable the merge button if no layers are selected.
                    var checkedMarkupLayers = $('[data-pcc-annotation-layer-review-section=other] .pcc-annotation-layer-review-section-content').find('.pcc-checked');
                    viewer.viewerNodes.$annotationLayerMerge.attr('disabled', checkedMarkupLayers.length === 0);
                };

                var fragment = document.createDocumentFragment();

                $container.empty();

                annotationLayers.sort(function (a, b) {
                    var aName = (a.getName() || '').toLowerCase();
                    var bName = (b.getName() || '').toLowerCase();
                    return aName === bName ? 0 : aName > bName ? 1 : -1;
                });

                var layerDivs = [];

                // Display the markup layers.
                _.forEach(annotationLayers, function(annotationLayer) {
                    var isHidden = annotationLayer.getSessionData('Accusoft-visibility') === 'hidden';
                    var visibilityIcon;
                    var visibilityTooltip;
                    var visibilityAction;

                    if (isHidden) {
                        visibilityIcon = 'pcc-icon-eye-closed';
                        visibilityTooltip = PCCViewer.Language.data.annotationLayerReview.show;
                        visibilityAction = showClickAction;
                    } else {
                        visibilityIcon = 'pcc-icon-eye';
                        visibilityTooltip = PCCViewer.Language.data.annotationLayerReview.hide;
                        visibilityAction = hideClickAction;
                    }

                    var divClassName = 'pcc-annotation-layer-review-' + classFragment + ' pcc-' + classFragment + '-layer pcc-row',
                        div = createElem('div', divClassName),
                        checkbox = createElem('span', 'pcc-checkbox pcc-hide'),
                        icon = createElem('span', 'pcc-icon pcc-icon-check'),
                        text = createElem('span'),
                        visibilityToggle = createElem('span', 'pcc-icon ' + visibilityIcon + ' pcc-pull-right');

                    visibilityToggle.setAttribute('title', visibilityTooltip);
                    updateIcon($(visibilityToggle));

                    text.appendChild(document.createTextNode(annotationLayer.getName() || ''));

                    checkbox.appendChild(icon);
                    div.appendChild(checkbox);
                    div.appendChild(text);
                    div.appendChild(visibilityToggle);
                    parseIcons($(div));

                    div.setAttribute('data-pcc-' + classFragment + '-layer', annotationLayer.getId());

                    $(checkbox).on('click', function() { checkboxClickAction(div); });

                    $(visibilityToggle).on('click', { layerId: annotationLayer.getId() }, visibilityAction);

                    fragment.appendChild(div);
                    layerDivs.push(div);
                });

                var toggler = ToggleAllControl('pcc-toggle-all pcc-row pcc-hide', function(state){
                    _.forEach(layerDivs, function(layerDiv) {
                        var isChecked = $(layerDiv).hasClass('pcc-checked');
                        var needToCheck = state === 'checked' && !isChecked;
                        var needToUncheck = state === 'unchecked' && isChecked;

                        if (needToCheck || needToUncheck) {
                            checkboxClickAction(layerDiv);
                        }
                    });
                });

                $container.append(toggler).append(fragment);
            };

            var createElem = function(type, className){
                var elem = document.createElement(type || 'div');
                if (typeof className === 'string') {
                    elem.className = className;
                }
                return elem;
            };

            // The publicly accessible members of this module.
            return {
                init: init,
                onOpenDialog: onOpenDialog,
                refresh: refresh
            };
        })();

        this.annotationLayerSave = (function(){
            var control, language, $parentDom, notify;

            function getLayerComments(layer) {
                var marks = control.getAllMarks(),
                    comments = [];

                _.each(marks, function(mark) {
                    comments = comments.concat(mark.getConversation().getComments());
                });

                comments = _.filter(comments, function(comment) {
                    return comment.getMarkupLayer() && comment.getMarkupLayer().getId() === layer.getId();
                });

                return comments;
            }

            function updateLayerComments(currentLayer) {
                var layerComments = getLayerComments(currentLayer);

                _.each(layerComments, function(comment) {
                    if (comment.getData('Accusoft-owner') === currentLayer.getSessionData('Accusoft-savedLayerName')) {
                        comment.setData('Accusoft-owner', currentLayer.getName());
                    }
                });

                currentLayer.setSessionData('Accusoft-savedLayerName', currentLayer.getName());
            }

            function onSuccessGen(currentLayer) {
                return function onSaveSuccess(recordInfo) {
                    $('.pcc-select-load-annotation-layers .pcc-label').text(currentLayer.getName());

                    control.refreshConversations();

                    notify({
                        message: language.annotations.save.success + currentLayer.getName(),
                        type: 'success'
                    });
                };
            }

            function onSaveFailure(reason) {
                //skip notify dialog if a license error occurs
                if (reason && reason.code === "LicenseCouldNotBeVerified")
                    return;
                notify({ message: language.annotations.save.failure + (language.error[reason.code] || '') });
            }

            function attachEvents(currentLayer) {
                viewer.viewerNodes.$annotationLayerSave.on('click', function() {
                    if (viewer.viewerNodes.$annotationLayerSave.hasClass('pcc-disabled')) {
                        return;
                    }

                    currentLayer.setName($parentDom.find('input[type=text]').val());

                    updateLayerComments(currentLayer);

                    control.saveMarkupLayer(currentLayer.getId()).then(onSuccessGen(currentLayer), onSaveFailure);

                    // Hide the save dialog.
                    var toggleID = 'dialog-annotation-layer-save';
                    $('[data-pcc-toggle="' + toggleID + '"]').toggleClass('pcc-active');
                    var $elBeingToggled = viewer.$dom.find('[data-pcc-toggle-id="' + toggleID + '"]');
                    toggleDialogs({
                        $elem: $elBeingToggled,
                        $target: $parentDom,
                        toggleID: toggleID,
                        $contextMenu: viewer.viewerNodes.$contextMenu
                    });
                });

                $parentDom.find('input[type=text]')
                    .on('keyup change', function(){
                        if (this.value !== "") {
                            viewer.viewerNodes.$annotationLayerSave.removeClass('pcc-disabled');
                        }
                        else {
                            viewer.viewerNodes.$annotationLayerSave.addClass('pcc-disabled');
                        }
                    });
            }

            function detachEvents() {
                $parentDom.off();
                viewer.viewerNodes.$annotationLayerSave.off();
            }

            function onOpenDialog(currentMarkupLayer) {
                // Clear the layer name text box
                $parentDom.find('input[type=text]').val('');

                detachEvents();
                attachEvents(currentMarkupLayer);
            }

            function onSave(currentMarkupLayer) {
                updateLayerComments(currentMarkupLayer);
                control.saveMarkupLayer(currentMarkupLayer.getId()).then(onSuccessGen(currentMarkupLayer), onSaveFailure);
            }

            function init(viewerControl, languageData, domElem, notifierFunc) {
                control = viewerControl;
                language = languageData;
                $parentDom = $(domElem);
                notify = notifierFunc;
            }

            return {
                init: init,
                onOpenDialog: onOpenDialog,
                onSave: onSave
            };
        })();

        var ToggleAllControl = (function() {
            function generateDom(classNames) {
                var toggler = document.createElement('div');
                toggler.className = classNames;

                var checkbox = document.createElement('span');
                checkbox.className = 'pcc-checkbox';

                var label = document.createElement('span');
                label.appendChild(document.createTextNode(PCCViewer.Language.data.toggleAll));

                var icon = document.createElement('span');
                icon.className = 'pcc-icon pcc-icon-check';
                checkbox.appendChild(icon);

                toggler.appendChild(checkbox);
                toggler.appendChild(label);


                parseIcons($(toggler));
                return toggler;
            }

            function construct(classNames, onToggle) {
                var checkedClass = 'pcc-checked';

                classNames = typeof classNames === 'string' ? classNames : '';
                onToggle = typeof onToggle === 'function' ? onToggle : function() {};

                var dom = generateDom(classNames || '');
                var $dom = $(dom);

                $dom.click(function(){
                    if ($dom.hasClass(checkedClass)) {
                        $dom.removeClass(checkedClass);
                        onToggle('unchecked');
                    } else {
                        $dom.addClass(checkedClass);
                        onToggle('checked');
                    }
                });

                return dom;
            }

            return construct;
        })();

        // create the eSignature UI module
        this.eSignature = (function () {

            var placeSignatureTool = PCCViewer.MouseTools.getMouseTool('AccusoftPlaceSignature');

            var $esignOverlay;
            var $esignPlace;

            var init = function () {
                $esignOverlay = viewer.viewerNodes.$esignOverlay;
                $esignPlace = viewer.viewerNodes.$esignPlace;

                // Find if we know which signature was used last
                _.forEach(PCCViewer.Signatures.toArray(), function(el) {
                    // Check if this signature was left selected during a previous session.
                    if (el.lastSelected) {
                        changeMouseToolSignature(el, true);
                        // Use `true` so that the mouse tool is not switched on.
                    }
                });

                attachListeners();
                updateSignatureButtons();
            };

            var refresh = function() {
                placeSignatureTool = PCCViewer.MouseTools.getMouseTool('AccusoftPlaceSignature');
                PCCViewer.MouseTools.createMouseTool("AccusoftPlaceDateSignature", PCCViewer.MouseTool.Type.PlaceSignature);
            }

            var destroy = function () {
                PCCViewer.Signatures.off('ItemAdded', signatureAdded);
                PCCViewer.Signatures.off('ItemRemoved', signatureRemoved);

                placeSignatureTool = undefined;
            };

            var attachListeners = function () {
                PCCViewer.Signatures.on('ItemAdded', signatureAdded);
                PCCViewer.Signatures.on('ItemRemoved', signatureRemoved);

                $esignOverlay.on('click', '.pcc-icon-delete', function(ev) {
                    localSignatureManager.clearAll();
                });
            };

            var updateSignatureButtons = function () {
                if (PCCViewer.Signatures.toArray().length > 0) {
                    $esignPlace.removeClass('pcc-disabled');
                    $esignPlace.removeAttr('disabled');
                } else {
                    $esignPlace.addClass('pcc-disabled');
                    $esignPlace.attr('disabled', '');
                }
            };

            // a signature was added to the PCCViewer.Signatures collection
            var signatureAdded = function (ev) {
                if (typeof ev.item === 'undefined') {
                    viewer.notify({message: PCCViewer.Language.data.noSignatures});
                    return;
                }

                // Enable the buttons if they were disabled
                updateSignatureButtons();
            };

            // a signature was removed from the PCCViewer.Signatures collection
            var signatureRemoved = function (ev) {
                var signatureArr = PCCViewer.Signatures.toArray();

                // unassociate the removed signature from the mouse tool if needed
                var accusoftPlaceSignature = PCCViewer.MouseTools.getMouseTool("AccusoftPlaceSignature");
                if (ev.item === accusoftPlaceSignature.getTemplateMark().getSignature()) {
                    accusoftPlaceSignature.getTemplateMark().setSignature(undefined);
                }

                // Disable the place button if there are no signatures
                updateSignatureButtons();
            };

            // This is used to keep track of the resized signature on the document.
            // We will use this size to insert the same signature with the same size next time.
            function updateSignatureSizeOnDocument(mark) {
                var signatureObj, compareIterator, sizeChanged = false;

                // Find the mark type and get references to the comparable properties
                switch (mark.getType()) {
                    case PCCViewer.Mark.Type.FreehandSignature:
                        compareIterator = function(sig){
                            return sig.path === mark.getPath();
                        };
                        break;
                    case PCCViewer.Mark.Type.TextSignature:
                        compareIterator = function(sig){
                            return sig.text === mark.getText() && sig.fontName === mark.getFontName();
                        };
                        break;
                }

                // Find the correct signature
                PCCViewer.Signatures.forEach(function(el){
                    if (compareIterator(el)) {
                        signatureObj = el;
                    }
                });

                if (signatureObj) {
                    // Save the width and height of the rectangle.
                    var rectangle = mark.getRectangle();

                    // Check if the size has changed and only update if necessary
                    if (signatureObj.documentHeight !== rectangle.width) {
                        signatureObj.documentWidth = rectangle.width;
                        sizeChanged = true;
                    }
                    if (signatureObj.documentHeight !== rectangle.height) {
                        signatureObj.documentHeight = rectangle.height;
                        sizeChanged = true;
                    }

                    // Save the signatures for use after psge refresh
                    // Let's avoid local storage if we don't have to
                    if (sizeChanged) {
                        localSignatureManager.setStored(PCCViewer.Signatures.toArray());
                    }
                }
            }

            function changeLastSelectedSignature(signature) {
                PCCViewer.Signatures.forEach(function(el){
                    el.lastSelected = (el === signature);
                });
            }

            function changeMouseToolRectangle(signature) {
                var templateMark = placeSignatureTool.getTemplateMark();

                templateMark.setRectangle({
                    x: 0, y: 0,
                    width: signature.documentWidth || 0,
                    height: signature.documentHeight || 0
                });
            }

            function changeMouseToolSignature(signature, skipMouseToolChange, apiTrigger) {
                var templateMark = placeSignatureTool.getTemplateMark();

                // Default to the first signature if one is not passed in
                // Just in case, check that a `path` or `text` is defined
                if (!signature || !(signature.path || signature.text)) {
                    signature = PCCViewer.Signatures.toArray().shift();
                }

                // Set the signature as the default to use with the PlaceSignature mouse tool
                templateMark.setSignature(signature);

                // Set the default size of this signature
                changeMouseToolRectangle(signature);

                // Mark this signature as the one currently selected
                changeLastSelectedSignature(signature);

                if (!skipMouseToolChange) {
                    viewer.setMouseTool({
                        mouseToolName: 'AccusoftPlaceSignature',
                        // API triggers will not change the locked/unlocked state of a mouse tool.
                        apiTrigger: !!apiTrigger
                    });
                }
            }

            // Updates the context menu if the PlaceSignature mouse tool is in use,
            // since the menu will already be open. If the menu is not open, a change from this
            // module is not necessary, as it will be initialized correctly when the
            // MouseToolChanged event fires.
            function contextMenuUpdater(signature){
                if (signature && viewer.viewerControl.getCurrentMouseTool() === placeSignatureTool.getName()){
                    // the context menu needs to be updated only if the mouse tool was already selected
                    updateContextMenu({
                        showContextMenu: true,
                        showAllEditControls: false,
                        mouseToolType: placeSignatureTool.getType()
                    });
                } else if (signature === undefined) {
                    // the context menu needs to be updated only if the mouse tool was already selected
                    updateContextMenu({
                        showContextMenu: false,
                        showAllEditControls: false,
                        mouseToolType: placeSignatureTool.getType()
                    });
                }
            }

            // generate a signature view for the manager utility
            // also generates generic view to use elsewhere
            function insertSignatureView (signature, domElem, clickHandler, includeButtons) {
                // create dom elements
                var wrapper = document.createElement('div'),
                    container = document.createElement('div'),
                    preview = document.createElement('div'),
                    buttons = document.createElement('div'),
                    name = document.createElement('span'),
                    deleteButton = document.createElement('button'),
                    downloadButton = document.createElement('button'),
                    useButton = document.createElement('button'),
                    useButtonIcon = document.createElement('span'),
                    useButtonText = document.createTextNode(PCCViewer.Language.data.esignUseSignature || 'Use signature'),
                    showButtons = (includeButtons === false) ? false : true;

                // add class names
                wrapper.className = 'pcc-esign-display';
                container.className = 'pcc-esign-preview-container' + ((signature.lastSelected) ? ' pcc-esign-active' : '');
                preview.className = 'pcc-esign-preview';
                deleteButton.className = 'pcc-icon pcc-icon-delete';
                deleteButton.title = PCCViewer.Language.data.esignDelete || '';
                downloadButton.className = 'pcc-icon pcc-icon-download';
                downloadButton.title = PCCViewer.Language.data.esignDownload || '';

                useButtonIcon.className = 'pcc-icon pcc-icon-place';
                useButton.appendChild(useButtonIcon);
                useButton.appendChild(useButtonText);

                buttons.className = 'pcc-margin-top';

                // make sure SVG does not zoom in (only zoom out)
                if (signature.width && signature.height) {
                    preview.style['max-width'] = signature.width + 'px';
                    preview.style['max-height'] = signature.height + 'px';
                }
                // create custom delete button
                deleteButton.onclick = function(){
                    // remove signature from collection
                    PCCViewer.Signatures.remove(signature);

                    // the currently selected signature was deleted
                    if (signature.lastSelected) {
                        // default to the first available signature in the collection
                        var newSignature = PCCViewer.Signatures.toArray().shift();

                        // If there's a new signature, update the UI to use it
                        if (newSignature) {
                            newSignature.lastSelected = true;
                            placeSignatureTool.getTemplateMark().setSignature(newSignature);

                            // re-init the Manager UI
                            viewer.launchESignManage();

                            // update the context menu if necessary
                            contextMenuUpdater(newSignature);
                        } else if (viewer.viewerControl.getCurrentMouseTool() === placeSignatureTool.getName()) {
                            // There are no signatures in the collection.
                            // If the PlaceSignature tool is selected, switch away from the it
                            viewer.setMouseTool({ mouseToolName: 'AccusoftPanAndEdit' });
                        }
                    }

                    // Remove UI elements as well
                    if (wrapper.parentElement) {
                        wrapper.parentElement.removeChild(wrapper);
                    }

                    // If there are no signatures left, re-initialize the Manager UI
                    // in order to display the 'no signatures' message.
                    if (PCCViewer.Signatures.toArray().length === 0){
                        viewer.launchESignManage();
                    }
                };

                // create custom download button
                downloadButton.onclick = function(){
                    // trigger a JSON file download
                    // let's also pretty-print the string
                    PCCViewer.Util.save('signature.json', JSON.stringify(signature, undefined, 2));
                };

                // create custom place signature button
                $(useButton).on('click', function(ev){
                    changeMouseToolSignature(signature, false, true);
                    viewer.closeEsignModal();

                    // update the context menu if necessary
                    contextMenuUpdater(signature);
                });

                $(container).on('click', (typeof clickHandler === 'function') ? clickHandler : function() {
                    $esignOverlay.find('.pcc-esign-preview-container').removeClass('pcc-esign-active');
                    $(this).addClass('pcc-esign-active');

                    // assign the signature to the mouse tool
                    changeMouseToolSignature(signature, true);

                    // update the context menu if necessary
                    contextMenuUpdater(signature);
                });

                // insert signature name if one was available
                if (signature.category) {
                    // let's escape unsafe characters
                    var textNode = document.createTextNode(signature.category);
                    name.appendChild(textNode);
                    name.className = 'pcc-pull-right pcc-icon-height';
                }

                // populate the DOM if the signature is rendered successfully
                function placeSuccessfulSignature() {
                    // add everything to the DOM
                    buttons.appendChild(name);
                    buttons.appendChild(deleteButton);
                    buttons.appendChild(downloadButton);
                    buttons.appendChild(useButton);

                    container.appendChild(preview);
                    wrapper.appendChild(container);

                    if (showButtons) {
                        wrapper.appendChild(buttons);
                    }

                    parseIcons($(wrapper));
                    domElem.appendChild(wrapper);
                }

                // populate the DOM if the signature data is unknown or invalid
                function placeCorruptSignature() {
                    // construct error DOM
                    var errorTextNode = document.createTextNode(PCCViewer.Language.data.esignCorruptData);
                    container.className = container.className + ' pccError pcc-text-center';

                    // build partial DOM
                    buttons.appendChild(deleteButton);
                    container.appendChild(errorTextNode);
                    wrapper.appendChild(container);
                    wrapper.appendChild(buttons);

                    parseIcons($(wrapper));
                    domElem.appendChild(wrapper);
                }

                // generate signature SVG
                try {
                    // this will include signature object validation
                    PCCViewer.SignatureDisplay(preview, signature);
                    // if successfull, we can display the signature
                    placeSuccessfulSignature();
                } catch (err) {
                    // any error probably means the signature object is incorrect
                    placeCorruptSignature();
                }
            }

            // puts dom elements into columns
            function placeIntoColumns (parentElement, childrenArray) {
                var Column = function(){
                    var col = document.createElement('div');
                    // makes 2 columns
                    col.className = 'pcc-col-6';
                    return col;
                };

                var columns = [ Column(), Column() ];
                var columnsClone = [].concat(columns);

                _.forEach(childrenArray, function(child){
                    // take first column
                    var col = columnsClone.shift();
                    // place child inside it
                    col.appendChild(child);
                    // put back in as last column
                    columnsClone.push(col);
                });

                _.forEach(columns, function(col){
                    parentElement.appendChild(col);
                });
            }

            // create a new SignatureControl drawing context
            function getFreehandContext (domElem) {
                return PCCViewer.SignatureControl(domElem);
            }

            // create a custom text signature context
            function getTextContext ($previews, $textInput) {
                var fonts = fontLoader.names(),
                    previewsArray = [],
                    selectedFont = 'Times New Roman';
                // set default selected font
                if (fonts.length > 0) {
                    selectedFont = fonts[0];
                }

                function generatePreview(fontName, text){
                    var div = document.createElement('div');

                    div.className = 'pcc-button pcc-esign-text-preview';
                    // Note: IE8 requires that the font have a fallback
                    div.style.fontFamily = '"' + fontName + '", cursive';
                    div.setAttribute('data-pcc-font-name', fontName);

                    // make sure to escape all text
                    var textNode = document.createTextNode(text);
                    div.appendChild(textNode);

                    return div;
                }

                $previews = $previews || viewer.viewerNodes.$esignOverlay.find('[data-pcc-signature-previews]');

                $textInput = $textInput || (function() {
                    var $ti = viewer.viewerNodes.$esignOverlay.find('[data-pcc-esign="textInput"]'),
                        // find the correct event name based on the browser
                        eventName = ('oninput' in $ti.get(0)) ? 'input' : 'propertychange';

                    $ti.on(eventName, function(ev) {
                        if (ev.originalEvent.propertyName && ev.originalEvent.propertyName !== 'value') {
                            // if this is an old IE propertyChange event for anything other than 'value', ignore it
                            return;
                        }

                        // reset the html
                        $previews.html('');

                        var value = $ti.val();

                        previewsArray = _.map(fonts, function(fontName){
                            return generatePreview(fontName, value);
                        });

                        placeIntoColumns($previews.get(0), previewsArray);
                    });

                    return $ti;
                })();

                $previews.on('click', '.pcc-esign-text-preview', function(ev){
                    _.forEach(previewsArray, function(el){
                        $(el).removeClass('pcc-esign-text-active');
                    });
                    $(this).addClass('pcc-esign-text-active');
                    selectedFont = this.getAttribute('data-pcc-font-name');
                });

                // return an object similar to PCCViewer.SignatureControl
                return {
                    done: function(){
                        return {
                            type: 'text',
                            text: $textInput.val(),
                            fontName: selectedFont
                        };
                    },
                    clear: function(){
                        $textInput.val('');
                        $previews.html('');
                        $textInput.focus();
                    }
                };
            }

            function getManageContext (domElem) {
                // create non-blocking queue
                var queue = new Queue();

                // Populate DOM with known signatures.
                PCCViewer.Signatures.forEach(function(el) {
                    // Let's place each signature rendering in its own iteration of the event loop
                    // so that the UI is not blocked for too long in older browsers and mobile.
                    queue.push(function(){
                        insertSignatureView(el, domElem);
                    });
                });

                // execute the queue
                queue.run();
            }

            return {
                init: init,
                refresh: refresh,
                destroy: destroy,
                mouseTool: placeSignatureTool,
                getFreehandContext: getFreehandContext,
                getTextContext: getTextContext,
                getManageContext: getManageContext,
                insertSignatureView: insertSignatureView,
                changeMouseToolSignature: changeMouseToolSignature,
                changeMouseToolRectangle: changeMouseToolRectangle,
                updateSignatureSizeOnDocument: updateSignatureSizeOnDocument
            };
        })();

        // This module manages the hyperlink proximity menu and UI
        var hyperlinkMenu = (function(){
            var control,
                language,
                template,
                globalDom,
                globalDismiss,
                // get a new proximityDismiss object to use for this menu
                proximityDismiss = ProximityDismiss(viewer.$dom);

            function createDOM(opts) {
                var div = document.createElement('div'),
                    hrefType = 'url',
                    hyperlinkType = 'textHyperlink';
                div.className = 'pcc-hyperlink-menu';

                if (opts.mark instanceof PCCViewer.DocumentHyperlink) {
                    hyperlinkType = 'documentHyperlink';

                    // if href contains only a number, then it is an intra-document page link
                    if (!isNaN(opts.href)) {
                        hrefType = 'page';
                    }

                }

                $(div).html(_.template(template)({
                    mode: opts.mode,
                    link: opts.href,
                    language: language,
                    hrefType: hrefType,
                    hyperlinkType: hyperlinkType
                }));

                return div;
            }

            function dismissHandler(ev){
                ev = ev || {};

                if (ev.target && $.contains(globalDom, ev.target)){
                    // this is a click inside the hyperlink menu, so we will not dismiss
                    // add another handler for the next click
                    return;
                }

                globalDismiss(ev.type === 'scroll');
            }

            function bindDOM(opts) {
                var useScrollDismiss = true,
                    usingTouch = false,
                    inputIsFocused = false;

                var $input = $(opts.dom).find('input').val(opts.href).on('input propertychange', function(ev){
                    // check if it is a propertychange event, and check the property
                    var event = ev.originalEvent ? ev.originalEvent : ev;

                    if (event.type === 'propertychange' && event.propertyName !== 'value'){
                        // this is a legacy IE event not related to the input value
                        return;
                    }

                    if (ev.target.value && ev.target.value.length) {
                        $done.removeAttr('disabled');
                    } else {
                        $done.attr('disabled', 'disabled');
                    }
                }).on('keypress', function(ev){
                    // submit the value with the enter key
                    if (ev.which === 13) {
                        dismissHandler();
                    }
                }).on('touchstart click', function(ev){
                    // keep any click or touch in the input field from bubbling up and causing other events
                    ev.preventDefault();

                    if (ev.type === 'touchstart') {
                        usingTouch = true;

                        // We know that the user is using touch, and they have tapped on the input box to focus it.
                        // We can be pretty sure that the toch keyboard is about to open, causing scroll events to occus,
                        // especially on iOS. We need to ignore these scroll events in terms of dismissing the menu, so that
                        // users can type in their link.
                        useScrollDismiss = false;
                    }

                    return false;
                }).on('focus', function(){
                    inputIsFocused = true;

                    // As long as the user is using touch, and the input is in focus, we should not dismiss for scroll events.
                    // The user is more likely to be dismissing the touch keyboard or trying to move the input box into a
                    // visible location.
                    useScrollDismiss = usingTouch ? false : useScrollDismiss;
                }).on('blur', function(){
                    inputIsFocused = false;

                    // The input has lost focus, so it is safe to dismiss on scroll now.
                    useScrollDismiss = true;
                });

                var dismissed = false;
                function dismiss(isScroll){
                    if (!useScrollDismiss && isScroll) {
                        // do not dismiss if this scroll is due to the touch keyboard opening
                        return;
                    }

                    // make sure the menu is dismissed only once
                    if (dismissed) {
                        return;
                    } else {
                        dismissed = true;
                    }

                    if (opts.mode === 'edit' && $input.val()) {
                        // there is a value, so save it
                        setHref(opts.mark, $input.val());
                    } else if (!opts.mark.getHref() && control.getMarkById(opts.mark.getId())) {
                        // this is a cancel and there was no previous value
                        control.deleteMarks([opts.mark]);
                    }

                    clearDOM();
                    $(document.body).off('mousedown touchstart', dismissHandler);
                    proximityDismiss.remove();

                    // if the mark is already selected, use mark selection to refresh the context menu
                    if (opts.mode === 'edit' && _.contains(control.getSelectedMarks(), opts.mark)){
                        control.deselectMarks([opts.mark]);
                        control.selectMarks([opts.mark]);
                    }
                }

                var $done = $(opts.dom).find('[data-pcc-hyperlink="done"]').click(function(){
                    setHref(opts.mark, $input.val());
                    dismiss();
                });

                var $delete = $(opts.dom).find('[data-pcc-hyperlink="delete"]').click(function(){
                    control.deleteMarks([opts.mark]);
                    dismiss();
                });

                var $clear = $(opts.dom).find('[data-pcc-hyperlink="clear"]').click(function(){
                    $input.val('').focus();
                    $done.attr('disabled', 'disabled');
                });

                var $link = $(opts.dom).find('[data-pcc-link-navigate]').on('click', function(ev){

                    if (this.getAttribute('data-href-type') === 'page') {
                        ev.preventDefault();
                        control.setPageNumber(this.getAttribute('href'));
                    }

                    dismiss();
                });

                var $edit = $(opts.dom).find('[data-pcc-hyperlink="edit"]').click(function(){
                    // create a new menu in edit mode
                    dismiss();
                    createMenu(opts.mark, 'edit', opts.clientX, opts.clientY);
                });

                setTimeout(function(){
                    // delay subscription, since triggering a menu as a result of a click will also trigger this event
                    $(document.body).on('mousedown touchstart', dismissHandler);
                    // do not dismiss the menu if the user moves away when in edit mode
                    opts.useMoveTrigger = opts.mode !== 'edit';
                    proximityDismiss.add(opts, dismissHandler);

                    // delay so that focus occurs after the menu is displayed
                    $input.focus();

                    // if there is no content, disable the done button
                    if (!$input.val()) {
                        $done.attr('disabled', 'disabled');
                    }
                }, 0);

                return dismiss;
            }

            function clearDOM() {
                if (globalDismiss && typeof globalDismiss === 'function') {
                    globalDismiss();
                    globalDismiss = undefined;
                }

                if (globalDom && $.contains(document.body, globalDom)){
                    $(globalDom).empty();
                    globalDom.parentElement.removeChild(globalDom);
                    globalDom = undefined;
                }
            }

            function positionDOM(opts) {
                var clientYscroll = opts.clientY + (window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0),
                    clientXscroll = opts.clientX + (window.scrollX || document.body.scrollLeft || document.documentElement.scrollLeft || 0),
                    domBB = opts.dom.getBoundingClientRect(),
                    width = domBB.width || domBB.right - domBB.left,
                    height = domBB.height || domBB.bottom - domBB.top,
                    offset = 10,
                    windowHeight = $(window).height(),
                    windowWidth = $(window).width(),
                    top = Math.min(clientYscroll + offset, (windowHeight - height - offset)),
                    left = Math.min(clientXscroll + offset, (windowWidth - width - offset)),
                    style = { top: top + 'px', left: left + 'px'};

                if (!!opts.href) {
                    // center every menu except the creation one
                    left = Math.max(offset, clientXscroll - (width / 2));
                    style.left = left + 'px';
                }

                if (clientYscroll + height + offset > windowHeight) {
                    // menu will display past the bottom edge
                    style.bottom = (windowHeight - clientYscroll - offset) + 'px';
                    style.top = 'auto';
                }

                if (clientXscroll + width + offset > windowWidth) {
                    // menu will display past the right edge
                    style.right = offset + 'px';
                    style.left = 'auto';
                }

                var styleString = _.map(style, function(val, name){ return name + ':' + val; }).join(';');
                opts.dom.setAttribute('style',  styleString);
            }

            function createMenu(mark, mode, clientX, clientY) {
                var opts = {
                    mark: mark,
                    mode: mode,
                    href: mark.getHref(),
                    clientX: clientX,
                    clientY: clientY
                },
                    dom = createDOM(opts);

                parseIcons($(dom));

                opts.dom = dom;

                globalDismiss = bindDOM(opts);
                document.body.appendChild(dom);
                positionDOM(opts);
                globalDom = dom;

            }

            function hyperlinkMenuHandler(ev, mode) {
                clearDOM();

                if (ev.clientX && ev.clientY) {
                    createMenu(ev.mark || ev.hyperlink, mode, ev.clientX, ev.clientY);
                }
            }

            function setHref(mark, linkText){
                // if no protocol is specified, add the default "http://"
                if (!linkText.match(/^([a-zA-Z]+\:)?\/\//)){
                    linkText = 'http://' + linkText;
                }

                mark.setHref(linkText);
            }

            function markCreatedHandler(ev){
                if (ev.mark.getType() === PCCViewer.Mark.Type.TextHyperlinkAnnotation && ev.clientX && ev.clientY) {
                    hyperlinkMenuHandler(ev, "edit");
                }
            }

            function init(viewerControl, languageOptions, hyperlinkMenuTemplate, getCurrentMouseToolType){
                control = viewerControl;
                language = languageOptions;
                template = hyperlinkMenuTemplate.replace(/>[\s]{1,}</g, '><');

                control.on(PCCViewer.EventType.Click, function(ev){
                    var mouseToolType = getCurrentMouseToolType();
                    if (mouseToolType !== "PanAndEdit" && mouseToolType !== "EditMarks") {
                        // user is using a non-edit tool, so we should ignore the click
                        return;
                    }

                    if (ev.targetType === "mark" && (ev.mark && ev.mark.getType && ev.mark.getType() === PCCViewer.Mark.Type.TextHyperlinkAnnotation)) {
                        var selectedMarks = control.getSelectedMarks();
                        if (ev.originalEvent.shiftKey) {
                            // Return if the user did not click to select a single hyperlink.
                            return;
                        }

                        if (ev.clientX && ev.clientY) {
                            // trigger the menu when clicking on a hyperlink mark with x and y coordinates
                            hyperlinkMenuHandler(ev, "view");
                        }
                    } else if (ev.targetType === "documentHyperlink") {
                        hyperlinkMenuHandler(ev, "view");
                    }
                });

                control.on(PCCViewer.EventType.MarkCreated, markCreatedHandler);
            }

            return {
                init: init,
                setHref: setHref,
                triggerMenu: markCreatedHandler
            };
        })();

        // This module manages the redaction reason proximity menu and UI
        var redactionReasonMenu = (function(){
            var control,
                language,
                template,
                maxFreeformReasonLength,
                preloadedRedactionReasons = {},
                globalDom,
                globalDismiss;

            function menuHandler(ev, mode) {
                clearDOM();

                if (ev.clientX && ev.clientY) {
                    // On some devices, setTimeout prevents the dismissal of menu when immediate action menu closes
                    setTimeout(function() {
                        createMenu(ev.mark || ev.hyperlink, mode, ev.clientX, ev.clientY);
                    },0);
                }
            }

            function createMenu(mark, mode, clientX, clientY) {
                var opts = {
                        mark: mark,
                        mode: mode,
                        clientX: clientX,
                        clientY: clientY
                    },
                    dom = createDOM(opts);

                parseIcons($(dom));

                opts.dom = dom;

                globalDismiss = bindDOM(opts);
                document.body.appendChild(dom);
                positionDOM(opts);
                globalDom = dom;
            }

            function createDOM (opts) {
                var div = document.createElement('div');
                div.className = 'pcc-redaction-reason-menu';

                var customRedactionReason;
                if (options.enableMultipleRedactionReasons) {
                    customRedactionReason = getMultipleRedactionReasonsText(opts.mark.getReasons());
                } else {
                    customRedactionReason = opts.mark.getReason();
                }

                $(div).html(_.template(template)({
                    language: language,
                    mark: opts.mark,
                    customRedactionReason: customRedactionReason
                }));

                return div;
            }

            function bindDOM(opts) {
                var useScrollDismiss = true,
                    usingTouch = false,
                    inputIsFocused = false;

                var $input = $(opts.dom).find('input').on('input propertychange', function(ev){
                    // check if it is a propertychange event, and check the property
                    var event = ev.originalEvent ? ev.originalEvent : ev;

                    if (event.type === 'propertychange' && event.propertyName !== 'value'){
                        // this is a legacy IE event not related to the input value
                        return;
                    }

                    if (ev.target.value && ev.target.value.length) {
                        $done.removeAttr('disabled');
                    } else {
                        $done.attr('disabled', 'disabled');
                    }
                }).on('touchstart click', function(ev){
                    // keep any click or touch in the input field from bubbling up and causing other events
                    ev.preventDefault();

                    if (ev.type === 'touchstart') {
                        usingTouch = true;

                        // We know that the user is using touch, and they have tapped on the input box to focus it.
                        // We can be pretty sure that the touch keyboard is about to open, causing scroll events to occur,
                        // especially on iOS. We need to ignore these scroll events in terms of dismissing the menu, so that
                        // users can type in their link.
                        useScrollDismiss = false;
                    }

                    return false;
                }).on('focus', function(){
                    inputIsFocused = true;

                    // As long as the user is using touch, and the input is in focus, we should not dismiss for scroll events.
                    // The user is more likely to be dismissing the touch keyboard or trying to move the input box into a
                    // visible location.
                    useScrollDismiss = usingTouch ? false : useScrollDismiss;
                }).on('blur', function(){
                    inputIsFocused = false;

                    // The input has lost focus, so it is safe to dismiss on scroll now.
                    useScrollDismiss = true;
                }).on('input', function(ev) {
                    var val = $(this).val();
                    if (viewer.redactionReasons.maxLengthFreeformRedactionReasons && val.length > viewer.redactionReasons.maxLengthFreeformRedactionReasons){
                        viewer.notify({message: PCCViewer.Language.data.redactionReasonFreeforMaxLengthOver});
                        $(this).val(val.substring(0, viewer.redactionReasons.maxLengthFreeformRedactionReasons));
                    }
                    if (options.enableMultipleRedactionReasons) {
                        opts.mark.setReasons([$(this).val()]);
                    } else {
                        opts.mark.setReason($(this).val());
                    }
                });

                var dismissed = false;
                function dismiss(){
                    // make sure the menu is dismissed only once
                    if (dismissed) {
                        return;
                    } else {
                        dismissed = true;
                    }

                    clearDOM();
                    $(document.body).off('mousedown touchstart', dismissHandler);

                    // if the mark is already selected, use mark selection to refresh the context menu
                    if (_.contains(control.getSelectedMarks(), opts.mark)){
                        control.deselectMarks([opts.mark]);
                        control.selectMarks([opts.mark]);
                    }
                }

                var $done = $(opts.dom).find('[data-pcc-redaction-reason="done"]').click(dismiss);

                var $clear = $(opts.dom).find('[data-pcc-redaction-reason="clear"]').click(function(){
                    $input.val('').focus();
                    if (options.enableMultipleRedactionReasons) {
                        opts.mark.setReasons([]);
                    } else {
                        opts.mark.setReason('');
                    }
                    $done.attr('disabled', 'disabled');
                });

                function dismissHandler(ev){
                    ev = ev || {};

                    if (ev.target && $.contains(opts.dom, ev.target)){
                        // this is a click inside the hyperlink menu, so we will not dismiss
                        // add another handler for the next click
                        return;
                    }

                    if (!useScrollDismiss && ev.type === "scroll") {
                        // do not dismiss if this scroll is due to the touch keyboard opening
                        return;
                    }

                    dismiss();
                }

                setTimeout(function(){
                    // delay subscription, since triggering a menu as a result of a click will also trigger this event
                    $(document.body).on('mousedown touchstart', dismissHandler);
                    // do not dismiss the menu if the user moves away when in edit mode
                    opts.useMoveTrigger = opts.mode !== 'edit';

                    // delay so that focus occurs after the menu is displayed
                    $input.focus();

                    // if there is no content, disable the done button
                    if (!$input.val()) {
                        $done.attr('disabled', 'disabled');
                    }
                }, 0);

                return dismiss;
            }


            function positionDOM(opts) {
                var clientYscroll = opts.clientY + (window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0),
                    clientXscroll = opts.clientX + (window.scrollX || document.body.scrollLeft || document.documentElement.scrollLeft || 0),
                    domBB = opts.dom.getBoundingClientRect(),
                    width = domBB.width || domBB.right - domBB.left,
                    height = domBB.height || domBB.bottom - domBB.top,
                    offset = 10,
                    windowHeight = $(window).height(),
                    windowWidth = $(window).width(),
                    top = Math.min(clientYscroll + offset, (windowHeight - height - offset)),
                    left = Math.min(clientXscroll + offset, (windowWidth - width - offset)),
                    style = { top: top + 'px', left: left + 'px'};

                if (clientYscroll + height + offset > windowHeight) {
                    // menu will display past the bottom edge
                    style.bottom = (windowHeight - clientYscroll - offset) + 'px';
                    style.top = 'auto';
                }

                if (clientXscroll + width + offset > windowWidth) {
                    // menu will display past the right edge
                    style.right = offset + 'px';
                    style.left = 'auto';
                }

                var styleString = _.map(style, function(val, name){ return name + ':' + val; }).join(';');
                opts.dom.setAttribute('style',  styleString);
            }

            function clearDOM() {
                if (globalDismiss && typeof globalDismiss === 'function') {
                    globalDismiss();
                    globalDismiss = undefined;
                }

                if (globalDom && $.contains(document.body, globalDom)){
                    globalDom.parentElement.removeChild(globalDom);
                    globalDom = undefined;
                }
            }

            function isPreloadedRedactionReason(reason) {
                if(Array.isArray(reason)){
                    for (var i=0;i<reason.length;i++) {
                        if (preloadedRedactionReasons[reason[i]] !== true) {
                            return false;
                        }
                    }
                    return true;
                } else {
                    return ( preloadedRedactionReasons[reason] === true);
                }
            }

            function init(viewerControl, languageOptions, redactionReasonMenuTemplate, redactionReasons, maxLength){
                control = viewerControl;
                language = languageOptions;
                template = redactionReasonMenuTemplate.replace(/>[\s]{1,}</g, '><');
                maxFreeformReasonLength = maxLength;

                _.forEach(redactionReasons, function(reason) {
                    preloadedRedactionReasons[reason.reason] = true;
                });
            }

            return {
                init: init,
                triggerMenu: menuHandler,
                isPreloadedRedactionReason: isPreloadedRedactionReason
            };

        })();

        // This module manages the menu that appears when a user creates an annotation.
        var immediateActionMenu = (function(){
            // All of the available immediate actions
            // Each object includes the following properties:
            // - name {string} : The name shown in the menu.
            // - action {function} : The function to execute when selected from the menu.
            // - valid {function} : Whether the action is valid for this type of mark or event
            //     and should be displayed in the menu. Returns a boolean.
            var actions = [{
                name: "Add Comment",
                languageKey: "addComment",
                action: function(ev, mark) {
                    commentUIManager.addComment(mark.getConversation());
                },
                valid: function(event, type, elem){
                    // add this for annotations and redactions only
                    return !!actionsFilter.comment && type && !!type.match(/(annotation|redaction)/i);
                }
            },{
                name: "Select",
                languageKey: "select",
                action: function(ev, mark){
                    // deselect all marks
                    control.deselectAllMarks();
                    // select only this one
                    control.selectMarks([mark]);
                },
                valid: function(event, type, elem){
                    // add this for annotations and redactions only
                    return !!actionsFilter.select && type && !!type.match(/(annotation|redaction)/i) && event.toLowerCase() !== PCCViewer.EventType.Click.toLowerCase();
                }
            },{
                name: "Copy...",
                languageKey: "copyMenu",
                action: function(ev) {
                    initCopy(ev.selectedText);
                },
                valid: function(event, type, elem){
                    // add this for text selection only
                    return !!actionsFilter.copy && event.toLowerCase() === PCCViewer.EventType.TextSelected.toLowerCase();
                }
            },{
                name: "Highlight",
                languageKey: "highlight",
                action: function(ev){
                    // Create a highlight mark from the textSelection in the event
                    var mark = control.addMark(ev.textSelection.pageNumber, PCCViewer.Mark.Type.HighlightAnnotation);
                    mark.setPosition(ev.textSelection);

                    // Clear the text selection
                    control.clearMouseSelectedText(ev.textSelection);

                    // Open a new menu as if a "MarkChanged" fired
                    replaceMenu({
                        mark: mark,
                        clientX: ev.clientX,
                        clientY: ev.clientY,
                        getType: function(){ return "MarkCreated"; }
                    });

                    return false;
                },
                valid: function(event, type, elem){
                    // add this for text selection only
                    return !!actionsFilter.highlight && event.toLowerCase() === PCCViewer.EventType.TextSelected.toLowerCase();
                }
            },{
                name: "Redact",
                languageKey: "redact",
                action: function(ev){
                    // Create a highlight mark from the textSelection in the event
                    var mark = control.addMark(ev.textSelection.pageNumber, PCCViewer.Mark.Type.TextSelectionRedaction);
                    mark.setPosition(ev.textSelection);

                    // Clear the text selection
                    control.clearMouseSelectedText(ev.textSelection);

                    // Open a new menu as if a "MarkChanged" fired
                    replaceMenu({
                        mark: mark,
                        clientX: ev.clientX,
                        clientY: ev.clientY,
                        getType: function(){ return "MarkCreated"; }
                    });

                    return false;
                },
                valid: function(event, type, elem){
                    // add this for text selection only
                    return !!actionsFilter.redact && event.toLowerCase() === PCCViewer.EventType.TextSelected.toLowerCase();
                }
            },{
                name: "Hyperlink",
                languageKey: "hyperlink",
                action: function(ev){
                    var mark = control.addMark(ev.textSelection.pageNumber, PCCViewer.Mark.Type.TextHyperlinkAnnotation);
                    mark.setPosition(ev.textSelection);

                    // Clear the text selection
                    control.clearMouseSelectedText(ev.textSelection);

                    // Open the menu to add the hyperlink text
                    hyperlinkMenu.triggerMenu({
                        mark: mark,
                        clientX: ev.clientX,
                        clientY: ev.clientY
                    });
                },
                valid: function(event, type, elem){
                    // add this for text selection only
                    return !!actionsFilter.hyperlink && event.toLowerCase() === PCCViewer.EventType.TextSelected.toLowerCase();
                }
            },{
                name: "Strikethrough",
                languageKey: "strikethrough",
                action: function(ev){
                    // Create a highlight mark from the textSelection in the event
                    var mark = control.addMark(ev.textSelection.pageNumber, PCCViewer.Mark.Type.StrikethroughAnnotation);
                    mark.setPosition(ev.textSelection);

                    // Clear the text selection
                    control.clearMouseSelectedText(ev.textSelection);

                    // Open a new menu as if a "MarkChanged" fired
                    replaceMenu({
                        mark: mark,
                        clientX: ev.clientX,
                        clientY: ev.clientY,
                        getType: function(){ return "MarkCreated"; }
                    });

                    return false;
                },
                valid: function(event, type, elem){
                    // add this for text selection only
                    return !!actionsFilter.strikethrough && event.toLowerCase() === PCCViewer.EventType.TextSelected.toLowerCase();
                }
            },{
                name: "Delete",
                languageKey: "delete",
                action: function(ev, mark){
                    viewer.viewerControl.deleteMarks(mark);
                },
                valid: function(event, type, elem){
                    // add this for text selection only
                    return !!actionsFilter["delete"] && type === 'RectangleRedaction';
                }
            },{
                name: "Cancel",
                languageKey: "cancelButton",
                action: function(){
                    // no need to do anything here
                },
                valid: function(event, type, elem){
                    // add this for all types
                    return !!actionsFilter.cancel && elem.children.length;
                }
            }];

            var menuClass = 'pcc-immediate-action-menu',
                itemClass = 'pcc-immediate-action-menu-item',
                hoverTriggerClass = 'pcc-hover-trigger',
                dom, // only one instance of the menu is supported
                touchstart,
                touchstartHandler,
                destroyFunction = function(ev){
                    ev = ev || { manualDismiss: true };

                    var $target = $(ev.target);

                    if (dom && dom.parentElement && (
                            ($target.length && !$target.hasClass(menuClass) && !$target.parents().hasClass(menuClass)) ||
                             ev.type === 'move' ||
                             ev.type === 'scroll' ||
                             ev.manualDismiss)
                       ){
                        $(dom).off(touchstart, touchstartHandler);
                        // remove dom
                        $(dom).empty();
                        dom.parentElement.removeChild(dom);
                        // remove the event
                        $(document.body).off('mousedown touchstart', destroyFunction);
                        // remove the proximity dismiss
                        proximityDismiss.remove();
                        // reset dom variable
                        dom = undefined;
                    }
                },
                actionsFilter = {},
                control,
                language = {},
                $overlay,
                $overlayFade,
                copyTemplate,
                useHoverEnter = false,
                redactionReasons = {},
                redactionReasonMenuTrigger,
                // get a new proximityDismiss object to use for this menu
                proximityDismiss = ProximityDismiss(viewer.$dom);

            function addRedactionReasonActions() {

                if (redactionReasons.enableRedactionReasonSelection === false) {
                    return;
                }

                // Remove the cancel button
                var cancelButton = actions.pop();

                _.each(redactionReasons.reasons, function(reason) {
                    actions.push({
                        name: reason.reason,
                        dom: function(mark) {
                            var $span = $('<span>');
                            if (!reason.selectable) {
                                $span.text(reason.reason);
                            } else {
                                $span.append(
                                    $('<em>').addClass('pcc-select-multiple-redaction-reason').text(reason.reason)
                                );
                                if (reason.description) {
                                    $span
                                        .append(': ')
                                        .append(
                                            $('<span>')
                                                .addClass('pcc-select-multiple-redaction-description')
                                                .text(reason.description)
                                        );
                                }
                            }
                            var $div = $('<div>')
                                .attr('title', reason.reason + (reason.description ? ': ' + reason.description : ''))
                                .append($span);

                            // Add checkbox
                            if (options.enableMultipleRedactionReasons && reason.selectable) {
                                $div
                                    .addClass('pcc-checkbox')
                                    .attr('data-pcc-checkbox', 'redaction-reasons')
                                    .prepend(
                                        $('<span>').addClass('pcc-icon').addClass('pcc-icon-check')
                                    );

                                if (mark && mark.reasons.indexOf(reason.reason) >= 0) {
                                    $div.addClass('pcc-checked');
                                }
                                parseIcons($div);
                            }

                            return $div[0];
                        },
                        action: function(ev, mark, domElement) {
                            var closeMenu = true;
                            if (reason.reason === language.redactionReasonClear) {
                                if (options.enableMultipleRedactionReasons) {
                                    mark.setReasons([]);
                                    // Unselect all the reasons
                                    $(domElement).parents('.pcc-immediate-action-menu').find('[data-pcc-checkbox="redaction-reasons"].pcc-checked').removeClass('pcc-checked');
                                    closeMenu = false;
                                } else {
                                    mark.setReason('');
                                }
                            } else if (reason.reason === PCCViewer.Language.data.redactionReasonFreeform) {
                                redactionReasonMenuTrigger(ev);
                            } else {
                                if (options.enableMultipleRedactionReasons) {
                                    var $parent = $(domElement).parents('.pcc-immediate-action-menu');
                                    var $div = $(domElement).find('[data-pcc-checkbox]');

                                    // check/uncheck clicked item
                                    $div.toggleClass('pcc-checked');

                                    // collect all checked reasons
                                    var $checkedReasons = $parent.find('[data-pcc-checkbox="redaction-reasons"].pcc-checked');
                                    var reasons = [];
                                    $checkedReasons.each(function(){
                                        reasons.push($(this).find('.pcc-select-multiple-redaction-reason').text());
                                    });
                                    mark.setReasons(reasons);
                                    closeMenu = false;
                                } else {
                                    mark.setReason(reason.reason);
                                }
                            }
                            return closeMenu;
                        },
                        valid: function(event, type, elem) {
                            return (type === 'RectangleRedaction' || type === "TextSelectionRedaction") && event.toLowerCase() !== PCCViewer.EventType.Click.toLowerCase();
                        }
                    });
                });

                // Add the cancel button back to the end
                actions.push(cancelButton);
            }

            function createDOM(elem, ev, mark) {
                if (fileDownloadManager.isInPreviewMode() !== true) {
                    var eventType = ev.getType().toLowerCase(),
                        list = document.createElement('ul'),
                        newClassName = elem.className + ' ' + menuClass + ' pccv';

                    elem.className = newClassName;

                    _.forEach(actions, function (item) {
                        if (item.valid(eventType, mark && mark.getType(), elem)) {
                            var li = document.createElement('li');
                            // escape any possible unsafe characters in the name
                            var itemDom = item.dom
                                ? item.dom(mark)
                                : document.createTextNode(language[item.languageKey] || item.name);
                            li.appendChild(itemDom);
                            li.className = itemClass;

                            // add event handler - Note that when using PointerEvent.preventDefault,
                            // it cancels further mouse events, but will still fire the click. If we
                            // use a click event here, the menu will not usable on a Windows Touch device.
                            // Instead, we will use 'mouseup touchend' to detect a click.
                            $(li).on('mouseup touchend', function ($ev) {
                                if ($ev.cancelable) {
                                    $ev.preventDefault();
                                }
                                if (preventSelect) {
                                    return;
                                }

                                var retValue = item.action(ev, mark, this);

                                // destroy the menu after any item is clicked
                                if (retValue !== false) {
                                    destroyFunction();
                                }
                            });

                            // Prevent selecting item on touch devices when you just want to scroll
                            // the immediate menu
                            var preventSelect;
                            $(li).on('touchstart', function($ev) {
                                preventSelect = false;
                            });
                            $(li).on('touchmove', function($ev) {
                                preventSelect = true;
                            });

                            list.appendChild(li);
                        }
                    });

                    elem.appendChild(list);
                }
            }

            function positionMenuDOM(clientX, clientY, handleClientX, handleClientY) {
                if (handleClientX === undefined || handleClientY === undefined) {
                    handleClientX = clientX;
                    handleClientY = clientY;
                }

                var handleClientYscroll = handleClientY + (window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0),
                    handleClientXscroll = handleClientX + (window.scrollX || document.body.scrollLeft || document.documentElement.scrollLeft || 0),
                    domBB = dom.getBoundingClientRect(),
                    width = domBB.width || domBB.right - domBB.left,
                    height = domBB.height || domBB.bottom - domBB.top,
                    offset = 10,
                    windowHeight = $(window).height(),
                    windowWidth = $(window).width(),
                    top = Math.min(handleClientYscroll + offset, (windowHeight - height - offset)),
                    left = Math.min(handleClientXscroll + offset, (windowWidth - width - offset)),
                    triggerDomBB = domBB,
                    triggerHeight = height,
                    triggerWidth = width,
                    style = { top: top + 'px', left: left + 'px'};

                if (useHoverEnter) {
                    // apply the hover trigger class here if requested
                    dom.className += ' ' + hoverTriggerClass;
                    triggerDomBB = dom.getBoundingClientRect();
                    triggerHeight = triggerDomBB.height || triggerDomBB.bottom - triggerDomBB.top;
                    triggerWidth = triggerDomBB.width || triggerDomBB.right - triggerDomBB.left;
                }

                if (handleClientX !== clientX || handleClientY !== clientY) {
                    var clientYscroll = clientY + (window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0),
                        clientXscroll = clientX + (window.scrollX || document.body.scrollLeft || document.documentElement.scrollLeft || 0);

                    if (clientXscroll > left && clientXscroll < left + triggerWidth && clientYscroll > top && clientYscroll < top + triggerHeight) {
                        // using the handle position the menu would appear under the mouse, so use the mouse position instead
                        positionMenuDOM(clientX, clientY);
                        return;
                    }
                }

                if (handleClientYscroll + height + offset > windowHeight) {
                    // menu will display past the bottom edge
                    if (useHoverEnter && (clientY + triggerHeight + offset > windowHeight)) {
                        style.bottom = offset + 'px';
                    } else {
                        style.bottom = (windowHeight - handleClientYscroll - offset) + 'px';
                    }

                    style.top = 'auto';
                }

                if (handleClientXscroll + width + offset > windowWidth) {
                    // menu will display past the right edge
                    if (useHoverEnter && (clientX + triggerWidth + offset > windowWidth)) {
                        style.right = offset + 'px';
                    } else {
                        style.right = (windowWidth - handleClientXscroll - offset) + 'px';
                    }

                    style.left = 'auto';
                }

                var styleString = _.map(style, function(val, name){ return name + ':' + val; }).join(';');
                dom.setAttribute('style',  styleString);
            }

            function replaceMenu(ev) {
                if (ev.clientX !== undefined && ev.clientY !== undefined) {
                    var newDom = document.createElement('ul');
                    if (ev.mark) {
                        // create a menu for the specific mark type
                        createDOM(newDom, ev, ev.mark);
                    } else if (ev.textSelection) {
                        // create a menu for the selected text
                        createDOM(newDom, ev);
                    } else {
                        // this event is not interesting, exit now
                        return;
                    }

                    // Destroy the menu if the replacement is empty
                    if (newDom.children.length === 0) {
                        destroyFunction();
                        return;
                    }

                    $(dom).removeAttr('style').children('ul').replaceWith(newDom.children);
                    positionMenuDOM(ev.clientX, ev.clientY, ev.handleClientX, ev.handleClientY);
                }
            }

            function menuClickHandler(ev) {
                if (ev.mark && ev.mark.getInteractionMode() === PCCViewer.Mark.InteractionMode.SelectionDisabled) {
                    menuHandler(ev);
                }
            }

            function menuHandler(ev) {
                if (ev.mark && ev.mark.getType() === PCCViewer.Mark.Type.TextHyperlinkAnnotation) {
                    // close a menu if it already exists, but do not create a new one
                    // hyperlink oncreate action is handled by the hyperlink menu
                    if (dom) {
                        destroyFunction();
                    }
                    return;
                }

                if (ev.clientX !== undefined && ev.clientY !== undefined) {
                    // Just to make sure we never have multiple menus, reuse the DOM container created previously when possible.
                    if (dom) {
                        destroyFunction();
                    }

                    dom = document.createElement('div');
                    var $icon = $('<span class="pcc-icon pcc-icon-list" />');

                    updateIcon($icon);

                    dom.appendChild($icon[0]);

                    if (ev.mark) {
                        // create a menu for the specific mark type
                        createDOM(dom, ev, ev.mark);
                    } else if (ev.textSelection) {
                        // create a menu for the selected text
                        createDOM(dom, ev);
                    } else {
                        // this event is not interesting, exit now
                        return;
                    }

                    // check if any actions are available
                    if (dom.children.length === 0) {
                        // there are no actions available for this event
                        // exit without showing a menu
                        return;
                    }

                    // insert the DOM into the document body
                    document.body.appendChild(dom);

                    // set position after the element is in the DOM
                    positionMenuDOM(ev.clientX, ev.clientY, ev.handleClientX, ev.handleClientY);

                    // make sure trigger doesn't auto-click the first item if using a touchscreen
                    if (useHoverEnter) {
                        var $dom = $(dom);

                        touchstartHandler = function(ev) {
                            if (/pointer/i.test(ev.type) && ev.originalEvent.pointerType === 'touch') {
                                // Do not cancel events if the viewport is already mobile
                                if (viewer.latestBreakpoint === viewer.breakpointEnum.mobile) {
                                    return;
                                }

                                // This is an IE pointer event, which cancels gover states. We will need to
                                // use a manual class here.
                                if (!$dom.hasClass('pcc-expanded')) {
                                    $dom.addClass('pcc-expanded');
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    return false;
                                }
                            } else if (!$(ev.target).hasClass('pcc-immediate-action-menu-item') && !$(ev.target).parents().hasClass('pcc-immediate-action-menu-item')) {
                                // In all other touch events, if the target is not an li, stop this
                                // event from continuing to a click -- this is used to expand a hover menu.
                                ev.preventDefault();
                                ev.stopPropagation();
                                return false;
                            }
                        };

                        // fix for touch screens and the hover menu
                        $dom.on('pointerdown', touchstartHandler);
                    }

                    // destroy the menu if anything other than the menu is clicked
                    $(document.body).on('mousedown touchstart', destroyFunction);

                    // expand the menu if it is hovered
                    $(dom).on('mouseenter touchstart', function(){
                        $(this).addClass('pcc-expanded');
                        var rect = dom.getBoundingClientRect();
                        if(rect.top < 0){
                            $dom.css({
                                top: dom.offsetTop - rect.top,
                                bottom: 'auto'
                            });
                        } else if(rect.bottom > window.innerHeight) {
                            $(dom).css({
                                top: dom.offsetTop - (rect.bottom - window.innerHeight),
                                bottom: 'auto',
                            });
                        }
                    });

                    // add a proximity desctory, to remove the menu if the user moves away from it
                    proximityDismiss.add({
                        clientX: ev.clientX,
                        clientY: ev.clientY,
                        dom: dom,
                        useDistanceToDomRect: true,
                        mouseMoveCallback: mouseMoveCallback,
                        distanceTolerance: 200
                    }, destroyFunction);
                }
            }

            function mouseMoveCallback(opts) {
                var opacityTreshhold = 0.75;
                var opacity = 1;

                var opacityTreshholdDistance = opts.distanceTolerance * opacityTreshhold;
                if (opts.currentDistance > opacityTreshholdDistance) {
                    opacity = Math.max(0, 1 - (opts.currentDistance - opacityTreshholdDistance) / (opts.distanceTolerance - opacityTreshholdDistance));
                }
                opts.dom.style.opacity = opacity;
            }

            function initCopy(text){
                var templateOptions = {
                    language: language
                };

                var $textArea;

                function showModal() {
                    $overlay.html(copyTemplate({
                            options: templateOptions
                        }))
                        .addClass('pcc-open')
                        .on('click', '.pcc-overlay-closer', function(ev) {
                            closeCopyOverlay($overlay, $overlayFade);
                        })
                        .on('click', closeCopyOverlayOnInteraction);

                    var textNode = document.createTextNode(text),
                        child = document.createElement('div');

                    var cleanText = text.replace(/\n/g, ' ').replace(/[\s]{2,}/g, ' ');
                    $textArea = $overlay.find('.pcc-copy-textarea').val(cleanText).select();
                }

                try {
                    if (document.queryCommandSupported && document.queryCommandSupported("cut")) {
                        var accessToClipboardGranted = true;
                        // IE8 - 10 will prompt the user for access
                        if (document.documentMode && document.documentMode >= 8 && document.documentMode <= 10) {
                            accessToClipboardGranted = document.execCommand("cut");
                        }

                        // Now we can show the modal for a brief moment and copy the contents to the clipboard
                        // This will/should happen so fast that the user will never get to see the modal
                        showModal();

                        // Let's check if the cut command worked by checking if the text area has not text in it
                        if (accessToClipboardGranted && document.execCommand("cut") && !$textArea.val().length) {
                            closeCopyOverlay();
                            return;
                        }
                    }
                } catch (e) {

                }

                showModal();
                $overlayFade.show();
                return $overlay;
            }

            function closeCopyOverlayOnInteraction(ev){
                if ($overlay.is(ev.target)) {
                    $overlay.on('click', closeCopyOverlayOnInteraction);
                    closeCopyOverlay();

                    // clear the selection, if still selected
                    // this is needed mostly for iOS
                    if (window.getSelection) {
                        var selection = window.getSelection();
                        selection.removeAllRanges();
                    }
                }
            }

            function closeCopyOverlay(){
                $overlay.off('click', closeCopyOverlayOnInteraction);
                $overlay.removeClass('pcc-open');

                // Remove the dark overlay
                $overlayFade.hide();

                $overlay.empty();
            }

            function init(opts) {
                actionsFilter = opts.actions;

                redactionReasons = _.clone(opts.redactionReasons);
                if (opts.redactionReasons.reasons) {
                    redactionReasons.reasons = opts.redactionReasons.reasons.map(function(reason) {
                        return _.clone(reason);
                    });
                }

                redactionReasonMenuTrigger = opts.redactionReasonMenuTrigger;
                control = opts.viewerControl;
                language = PCCViewer.Language.data;
                useHoverEnter = (opts.mode === 'hover');
                $overlay = opts.$overlay;
                $overlayFade = opts.$overlayFade;
                copyTemplate = _.template(opts.copyOverlay.replace(/>[\s]{1,}</g, '><'));

                // add viewer event listeners
                control.on(PCCViewer.EventType.MarkCreated, menuHandler);
                control.on(PCCViewer.EventType.TextSelected, menuHandler);
                control.on(PCCViewer.EventType.Click, menuClickHandler);

                addRedactionReasonActions();
            }

            return {
                init: init
            };
        })();

        // This module manages the comments interface and interacting with the comments.
        var commentUIManager = (function(){
            var editModeKey = 'Accusoft-isInEditMode',
                prevTextKey = 'Accusoft-previousText',
                selectedStateKey = 'Accusoft-selectedState',
                highlightKey = 'Accusoft-highlight',
                skinnyClass = 'pcc-skinny-comments',
                expandedClass = 'pcc-expanded',
                control,
                template,
                language,
                dateFormat,
                $toggleButton,
                $commentsPanel,
                $pageList,
                panelMode,
                // Steal jQuery to use its event framework.
                $event = $({}),
                dismissEvent = 'dismissPending';

            $event.store = {};

            function dismissCommentEdit(comment, opts) {
                // Clear the dismiss event listener on the body.
                if (opts.bodyClickDismiss && typeof opts.bodyClickDismiss === 'function') {
                    $(document.body).off('touchstart click', opts.bodyClickDismiss);
                }

                if (opts.cancel && opts.editMode === 'create') {
                    opts.conversation.deleteComments(comment);
                } else if (opts.cancel && opts.editMode === 'edit') {
                    comment.setData(editModeKey, undefined);
                    if (control.getMarkById(opts.conversation.getMark().getId())) {
                        control.refreshConversations(opts.conversation);
                    }
                } else if (opts.save) {
                    var val = $(opts.textarea).val(),
                        prevText = comment.getText();

                    if (val === prevText) {
                        // if text didn't change, treat this as a cancel
                        opts.cancel = true;
                        opts.save = false;
                        dismissCommentEdit(comment, opts);
                    } else if (val !== undefined) {
                        comment.setData(editModeKey, undefined);
                        comment.setText(val);
                    }
                }
            }

            function parseHighlightString(str) {
                var parts = str.split('|');
                var selections = _.map(parts, function(part){
                    return (function(){
                        var query = {},
                            temp = part.split('&');
                        for (var i = temp.length; i--;) {
                            var q = temp[i].split('='),
                                key = q.shift(),
                                value = q.join('=');
                            /* jshint -W116 */
                            // we want to take advantage of type coercion here
                            query[key] = (+value == value) ? +value : value;
                            /* jshint +W116 */
                        }
                        return query;
                    })();
                });

                return PCCViewer.Util.calculateNonOverlappingSelections(selections, '#ffffff');
            }

            function cleanupConversationEvents(markId, existingDom){
                // Clean up events on the old DOM
                if (existingDom) {
                    $(existingDom).off().find('*').off();
                }

                // Delete any old triggers from the event store
                if ($event.store[markId + 'triggers']) {
                    // remove old trigger events from event storage
                    _.forEach($event.store[markId + 'triggers'], function(val, name) {
                        if (typeof val === 'function') {
                            $event.off(name, val);
                        }
                    });
                    $event.store[markId + 'triggers'] = undefined;
                }
            }

            function conversationDOMFactory(conversation, state, existingDOM){
                var comments = conversation.getComments();
                if (comments.length === 0) {
                    return;
                }

                // Get the mark ID
                var markId = conversation.getMark().getId();

                // Check if this is a selection state change
                var selectedState = conversation.getData(selectedStateKey),
                    $existingDOM;

                if (selectedState === 'in' && existingDOM) {
                    $(existingDOM).addClass('pcc-conversation-selected');

                    // Show the reply box under the selected conversation if the last comment is not currently being added
                    // (if it is being added, it has no text yet).
                    if (comments.length > 0 && comments[comments.length - 1].getText().length > 0) {
                        $(existingDOM).find('.pcc-comment-reply').removeClass('pcc-comment-hide');
                    }

                    conversation.setData(selectedStateKey, undefined);
                    return existingDOM;
                } else if (selectedState === 'out' && existingDOM) {
                    $existingDOM = $(existingDOM);
                    $existingDOM.removeClass('pcc-conversation-selected');
                    $existingDOM.find('.pcc-conversation-container').removeClass('pcc-expanded');
                    updateIcon($existingDOM.find('.pcc-comment-trigger').removeClass('pcc-icon-x').addClass('pcc-icon-comment'));
                    $existingDOM.find('.pcc-comment-reply').addClass('pcc-comment-hide');

                    conversation.setData(selectedStateKey, undefined);
                    return existingDOM;
                }

                // Clean up any old events
                cleanupConversationEvents(markId, existingDOM);

                // Just in case this factory gets called with state hints and no DOM
                if (selectedState) {
                    conversation.setData(selectedStateKey, undefined);
                }

                var dom = document.createElement('div'),
                    $dom = $(dom);
                dom.className = 'pcc-conversation';

                var trigger = document.createElement('div'),
                    $trigger = $(trigger);
                $trigger.addClass('pcc-comment-trigger pcc-icon pcc-icon-comment');

                updateIcon($trigger);

                var container = document.createElement('div'),
                    $container = $(container);
                $container.addClass('pcc-conversation-container');

                dom.appendChild(trigger);
                dom.appendChild(container);

                _.forEach(comments, function(el, i, arr){
                    var fragment = document.createElement('div'),
                        editMode = el.getData(editModeKey),
                        highlight = el.getSessionData(highlightKey),
                        date = formatDate(el.getCreationTime(), dateFormat.toString()),
                        commentId = markId.toString() + 'c' + i;

                    // Create the DOM for each comment
                    var $comment = $(template({
                        comment: el,
                        editMode: editMode,
                        prevText: el.getText(),
                        date: date,
                        language: language,
                        first: (i === 0),
                        last: (i === arr.length - 1),
                        isMine: el.getMarkupLayer() === control.getActiveMarkupLayer(),
                        owner: el.getData('Accusoft-owner')
                    })).appendTo(fragment);

                    parseIcons($comment);

                    var $textarea = $(fragment).find('textarea');

                    // A highlight was requested by the advanced search module
                    if (highlight) {
                        // Get parsed values
                        var highlightValues = parseHighlightString(highlight);

                        // We will need to build the highlighted text DOM manually
                        var $div = $(fragment).find('.pcc-comment-text'),
                            textFragment = document.createDocumentFragment(),
                            // get the comment text
                            text = el.getText(),
                            textPart = '',
                            span;

                        _.forEach(highlightValues, function(val, i, arr){
                            if (i === 0) {
                                // this is text before any selections begin
                                // get the string from 0 to the start index
                                textPart = text.substring(0, val.startIndex);
                                textFragment.appendChild( document.createTextNode(textPart) );
                            }

                            span = null;
                            span = document.createElement('span');
                            // get the string from the start index with the correct length
                            textPart = text.substr(val.startIndex, val.length);
                            span.style.background = val.color;

                            span.appendChild( document.createTextNode(textPart) );
                            textFragment.appendChild(span);

                            if (arr[i + 1] && val.endIndex + 1 < arr[i + 1].startIndex) {
                                // there is text between this selection and the next
                                textPart = text.substring(val.endIndex + 1, arr[i + 1].startIndex);
                                textFragment.appendChild( document.createTextNode(textPart) );
                            }

                            if (i === arr.length - 1) {
                                // this is text after all the selections
                                // get the string from the end of the last selection to the end of the string
                                textPart = text.substr(val.startIndex + val.length);
                                textFragment.appendChild( document.createTextNode(textPart) );
                            }
                        });


                        $div.empty();

                        $div.append(textFragment);
                    }

                    // Create a dismiss function to use to dismiss this comment.
                    // All dismiss processes should call this function, so cleanup is performed.
                    function dismissFunction(){
                        // Remove comment dismiss and body dismiss event listeers.
                        $event.off(dismissEvent, dismissFunction);
                        $(document.body).off('click', bodyClickDismiss);
                        $textarea.off();

                        // Try to get the dismiss function for this comment
                        var dismissFunc = $event.store[commentId + 'dismiss'];

                        if (dismissFunc && typeof dismissFunc === 'function') {
                            dismissFunc();
                        }
                    }

                    function bodyClickDismiss(ev) {
                         // Check for a .pcc-comment parent
                        var $parent = $(ev.target).hasClass('pcc-comment') ? $(ev.target) : $(ev.target).parent('.pcc-comment');

                        // Check if the move context menu or context menu options is clicked
                        // Do not dismiss if one of these options are clicked
                        var contextMenuClick =  $(ev.target).data();
                        if (contextMenuClick.pccMoveContextMenu !== undefined || contextMenuClick.pccToggle === "context-menu-options") {
                          return;
                        }

                        // Check if the textarea for this comment is inside the clicked parent.
                        // Dismiss only if clicking outside of the comment currently in edit mode.
                        if (!($parent.length && $textarea.length && $.contains($parent.get(0), $textarea.get(0)))) {
                            if ($textarea.val() === '' && editMode === 'edit') {
                                // Do not allow the user to dismiss a comment from Edit mode if the text is empty.
                                return;
                            }

                            // Trigger a dismiss, to automatically dismiss all comments and clean up.
                            $event.trigger(dismissEvent);
                        }
                    }

                    // Partial options object for dismissing comment edits.
                    var dismissOpts = {
                        editMode: editMode,
                        commentId: commentId,
                        bodyClickDismiss: bodyClickDismiss,
                        dismissFunction: dismissFunction,
                        textarea: $textarea,
                        conversation: conversation
                    };

                    if (editMode) {
                        // Store only one dismiss function for each comment.
                        $event.store[commentId + 'dismiss'] = function dismissComment(){
                            // Remove self when executing
                            delete $event.store[commentId + 'dismiss'];

                            dismissOpts.save = true;
                            dismissCommentEdit(el, dismissOpts);
                        };

                        // Listen to dismiss events and dismiss this comment.
                        $event.one(dismissEvent, dismissFunction);

                        // Clicking anywhere outside the comment will save it, or cancel if no edits were done.
                        $(document.body).on('click', bodyClickDismiss);
                    }

                    // Add click handlers
                    $(fragment).children()
                        // listen to clicks on the Done button for comment editing
                        .on('click', '[data-pcc-comment="done"]', function(){
                            dismissOpts.save = true;
                            dismissFunction();
                        })
                        // listen to clicks on the Cancel button for comment editing
                        .on('click', '[data-pcc-comment="cancel"]', function(){
                            dismissOpts.cancel = true;
                            dismissFunction();
                        })
                        // listen to overflow menu trigger on touch screens
                        .on('touchend', '.pcc-comment-menu-trigger', function(ev){
                            ev.preventDefault();
                            $(this).parent('[data-pcc-comment-menu]').toggleClass('pcc-expanded');
                        })
                        .on('click', '[data-pcc-comment-delete]', function(ev){
                            // Keep this event from registering on the bodyClickDismiss handler
                            ev.stopPropagation();

                            // Make sure this button dismisses any other comment that is being edited.
                            // This includes comments that may belong to a different conversation.
                            $event.trigger(dismissEvent);

                            conversation.deleteComments(el);
                        })
                        .on('click', '[data-pcc-comment-edit]', function(ev){
                            // Keep this event from registering on the bodyClickDismiss handler.
                            ev.stopPropagation();

                            // Make sure this button dismisses any other comment that is being edited.
                            // This includes comments that may belong to a different conversation.
                            $event.trigger(dismissEvent);

                            el.setData(editModeKey, 'edit');
                            control.refreshConversations(conversation);
                        })
                        .appendTo(container);

                    // Check if there is a textarea.
                    if ($textarea.length) {
                        // Select the comment automatically
                        $dom.addClass('pcc-conversation-selected');
                        $container.addClass('pcc-expanded');
                        $trigger.addClass('pcc-icon-x').removeClass('pcc-icon-comment');

                        updateIcon($trigger);

                        var $doneButton = $dom.find('[data-pcc-comment="done"]');

                        var disableDone = function(){
                            if ($doneButton.attr('disabled') !== 'disabled') {
                                $doneButton.attr('disabled', 'disabled');
                            }
                        };

                        var enableDone = function(){
                            if ($doneButton.attr('disabled')) {
                                $doneButton.removeAttr('disabled');
                            }
                        };

                        // Listen to key events on the textarea
                        $textarea.on('keyup', function(){
                            if (this.value === "") {
                                disableDone();
                            } else {
                                enableDone();
                            }
                        }).on('touchstart click', function(ev){
                            // keep any click or touch in the input field from bubbling up and causing other events
                            ev.preventDefault();
                            $textarea.focus();
                        });

                        // Disable the Done button by default.
                        disableDone();

                        // Focus the textarea so that the user can start typing.
                        // Do this on the next event loop.
                        _.defer(function(){
                            $textarea.focus();
                        });
                    }
                });

                // Append text input to conversation, and show it if the conversation is selected and the last comment is not
                // currently being added (in which case it has no text yet).
                var selectedConversationInputWrapper = document.createElement('div');
                var inputClasses = (state.isSelected === true && (comments.length > 0 && comments[comments.length - 1].getText().length > 0)) ? 'pcc-comment-reply' : 'pcc-comment-reply pcc-comment-hide';
                selectedConversationInputWrapper.className = inputClasses;
                var selectedConversationInput = document.createElement('textarea');
                selectedConversationInput.className = 'pcc-comment-reply-input';
                $(selectedConversationInput).val(PCCViewer.Language.data.reply);
                selectedConversationInputWrapper.appendChild(selectedConversationInput);
                $container.append(selectedConversationInputWrapper);

                $(selectedConversationInputWrapper).on('click', function(ev){
                    // Keep this event from registering on the bodyClickDismiss handler.
                    ev.stopPropagation();

                    // Make sure this button dismisses any other comment that is being edited.
                    // This includes comments that may belong to a different conversation.
                    $event.trigger(dismissEvent);

                    addComment(conversation);
                });

                // Expand the comment
                function onExpandRequested(ev, params) {
                    if (params.mark === conversation.getMark()) {
                        // trigger a shrink for any already-expanded comments
                        $event.trigger('shrink');
                        // expand this comment
                        expand();
                    }
                }

                function onShrinkRequested(ev, params) {
                    if ($container.hasClass(expandedClass)) {
                        shrink();
                    }
                }

                function toggleSkinnyCommentState() {
                    if ($container.hasClass(expandedClass)) {
                        shrink();
                    } else {
                        expand();
                    }
                }

                function expand() {
                    $container.addClass(expandedClass);
                    $trigger.addClass('pcc-icon-x').removeClass('pcc-icon-comment');

                    updateIcon($trigger);
                }

                function shrink() {
                    $container.removeClass(expandedClass);
                    $trigger.removeClass('pcc-icon-x').addClass('pcc-icon-comment');

                    updateIcon($trigger);
                }

                // Clicking anywhere on the dom selects the comment
                $dom.on('click', function(ev) {

                    if (control.getSelectedConversation() !== conversation) {

                        // Deselect any previous marks
                        control.deselectAllMarks();

                        var mark = conversation.getMark();
                        if (mark.getInteractionMode() === PCCViewer.Mark.InteractionMode.Full) {
                            // Select the mark associated to the conversation that was clicked on
                            control.selectMarks(mark);
                        }
                        else {

                            // Prevent the body click handler from being called
                            ev.stopPropagation();

                            var bodyClickDismissSelection = function (ev) {
                                // Check for a .pcc-comment parent
                                var $parent = $(ev.target).hasClass('pcc-comment') ? $(ev.target) : $(ev.target).parent('.pcc-comment');

                                if ($parent.length) {
                                    return;
                                }

                                // An area other than the conversation was selected, so deselect the conversation
                                $(document.body).off('click', bodyClickDismissSelection);

                                // Check if there was a selected conversation that needs to be transitioned out
                                var prevSelected = control.getSelectedConversation();
                                if (prevSelected === mark.getConversation()) {
                                    prevSelected.setData(selectedStateKey, 'out');
                                    control.setSelectedConversation(null);
                                }
                            };

                            // If the mark is not interactive, just select the conversation
                            onSingleMarkSelected(mark);

                            // Since the mark can not be deselected, need to dismiss when clicking off of the comment
                            $(document.body).on('click', bodyClickDismissSelection);
                        }
                    }
                });

                // Clicking on the trigger will expand the comment
                $trigger.on('click', toggleSkinnyCommentState);

                // Save events in the event store, so they can be cleaned up later
                $event.store[markId + 'triggers'] = {
                    expand: onExpandRequested,
                    shrink: onShrinkRequested,
                    markId: markId
                };
                // Register events listeners from the store
                _.forEach($event.store[markId + 'triggers'], function(func, name) {
                    if (typeof func === 'function') {
                        $event.on(name, func);
                    }
                });

                if (state && state.isSelected) {
                    dom.className += ' pcc-conversation-selected';
                }

                // add JS hover handlers for legacy IE, which will not handle CSS hovers
                if (dom.attachEvent) {
                    var $hoverMenu = $dom.find('[data-pcc-comment-menu]')
                        .on('mouseenter', function(ev){
                            $(this).parent('[data-pcc-comment-menu]').addClass('pcc-expanded');
                        })
                        .on('mouseleave', function(ev){
                            $(this).parent('[data-pcc-comment-menu]').removeClass('pcc-expanded');
                        });
                }

                return dom;
            }

            function onSingleMarkSelected(mark) {
                var conversation = mark.getConversation();

                if (conversation.getComments().length) {
                    // get the current selected conversation
                    var prevConversation = control.getSelectedConversation();

                    // check if this is the same one as on this mark
                    if (prevConversation === conversation) {
                        // it is already selected, so do nothing
                        return;
                    }

                    // check if there was a selected conversation that needs to be transitioned out
                    if (prevConversation) {
                        prevConversation.setData(selectedStateKey, 'out');
                    }

                    // transition the new conversation in
                    conversation.setData(selectedStateKey, 'in');

                    control.setSelectedConversation(conversation);
                }
            }

            function onMarkSelected(ev) {
                var selectedMarks = control.getSelectedMarks();

                var singleMark = true, previousMarkId;

                if (selectedMarks.length === 0) {
                    singleMark = false;
                } else if (selectedMarks.length > 1) {
                    _.forEach(selectedMarks, function(mark, key){
                        if (previousMarkId) {
                            singleMark = (previousMarkId === mark.id) && singleMark;
                        }
                        previousMarkId = mark.id;
                    });
                }

                if (singleMark && selectedMarks[0].getConversation().getComments().length) {
                    // If there is only one mark, and it has comments, select the conversation view
                    onSingleMarkSelected(selectedMarks[0]);
                } else {
                    // Check if there was a selected conversation that needs to be transitioned out
                    // Deselect previous conversation, but only if the mark is interactive
                    var prevSelected = control.getSelectedConversation();
                    if (prevSelected && prevSelected.getMark().getInteractionMode() !== PCCViewer.Mark.InteractionMode.SelectionDisabled) {
                        prevSelected.setData(selectedStateKey, 'out');
                        control.setSelectedConversation(null);
                    }
                }
            }

            function onReviewLayerClick(ev) {
                if (ev.targetType === 'mark' && ev.mark.getInteractionMode() === PCCViewer.Mark.InteractionMode.SelectionDisabled ) {
                    onSingleMarkSelected(ev.mark);
                } else if (ev.targetType !== 'mark') {
                    var prevSelected = control.getSelectedConversation();
                    if (prevSelected) {
                        prevSelected.setData(selectedStateKey, 'out');
                        control.setSelectedConversation(null);
                    }
                }
            }

            function updatePanel(params) {
                if (panelMode !== 'auto') { return; }

                var size = $pageList.children().first().width();

                // This adjustment is done based on the size of the page list,
                // which can change for various reasons. Therefore, we will check
                // its size and determine whether to apply the skinny class.
                if (size < 600 && !$commentsPanel.hasClass(skinnyClass)) {
                    $commentsPanel.addClass(skinnyClass);
                } else if (size >= 600 && $commentsPanel.hasClass(skinnyClass)){
                    $commentsPanel.removeClass(skinnyClass);
                }
            }

            function openIfVisibleMarks() {
                if (!control) { return; }

                // Markup was loaded, so we need to check if there are any comments
                var commentsFound = false;
                _.forEach(control.getAllMarks(), function(mark) {

                    // Remove search highlights from comments
                    _.forEach(mark.getConversation().getComments(), function(comment) {
                        comment.setData('Accusoft-highlight', undefined);
                    });

                    if (mark.getConversation().getComments().length && mark.getVisible()) {
                        commentsFound = true;
                    }
                });

                // If there were comments in the Markup, open the comments panel
                if (commentsFound) {
                    $toggleButton.addClass('pcc-active');
                    control.openCommentsPanel();
                    if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
                    viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper').scrollLeft(viewer.viewerNodes.$pageList.find('.pccPageListContainerWrapper > div:first-child').width());
                }
            }

            function initPanelMode(mode){
                if (mode === 'auto') {
                    updatePanel({ size: $pageList.width() });
                } else if (mode === 'skinny') {
                    $commentsPanel.addClass(skinnyClass);
                }
            }

            function init(opts, commentsPanelViewerNode){
                control = opts.viewerControl;
                language = opts.language;
                template = _.template(opts.template.replace(/>[\s]{1,}</g, '><'));
                dateFormat = opts.commentDateFormat || 'MM/DD/YYYY h:mma';
                $toggleButton = $(opts.button);
                $commentsPanel = $(opts.panel);
                $pageList = $(opts.pageList);
                panelMode = opts.mode || 'auto';

                initPanelMode(panelMode);

                control.setConversationDOMFactory(conversationDOMFactory);
                control.on(PCCViewer.EventType.MarkSelectionChanged, onMarkSelected);
                control.on(PCCViewer.EventType.Click, onReviewLayerClick);

                control.on(PCCViewer.EventType.MarkupLoaded, openIfVisibleMarks);

                control.on(PCCViewer.EventType.MarkRemoved, function(ev) {
                    // Clean up any old events that exist for comments on this mark
                    cleanupConversationEvents(ev.mark.getId());
                });
            }

            function refresh() {
                control.setConversationDOMFactory(conversationDOMFactory);
                if (control.getIsCommentsPanelOpen()) {
                    $toggleButton.addClass('pcc-active');
                } else {
                    $toggleButton.removeClass('pcc-active');
                }
            }

            function destroy() {
                if ($commentsPanel) {
                    $commentsPanel.off().find('*').off();
                }
            }

            function externalCommentEvent(eventName) {
                return function commentEvent(id) {
                    var mark = control.getMarkById(id);

                    if (mark) {
                        $event.trigger(eventName, {
                            id: id,
                            mark: mark
                        });
                    }
                };
            }

            function addComment(conversation){
                // Dismiss all comments that are currently in edit mode
                $event.trigger(dismissEvent);

                if (!control.getIsCommentsPanelOpen()){
                    $toggleButton.addClass('pcc-active');
                    control.openCommentsPanel();
                    if (viewer.isFitTypeActive === true) { viewer.viewerControl.fitContent(viewer.currentFitType); }
                }

                var comment = conversation.addComment("");
                comment.setData('Accusoft-owner', viewer.viewerControl.getActiveMarkupLayer().getName());
                comment.setData(editModeKey, 'create');
            }

            return {
                init: init,
                refresh: refresh,
                addComment: addComment,
                expandComment: externalCommentEvent('expand'),
                updatePanel: updatePanel,
                openIfVisibleMarks: openIfVisibleMarks,
                destroy: destroy
            };
        })();

        // This module is for the imageTools dropdown menu
        this.imageToolsDropdownUI = (function() {
            var defaultValue = {
                sharpening: 0,
                gamma: 0.5,
                strokeWidth: 0
            };
            var hasBeenInitialized = false;
            var lineSharpeningSlider;
            var svgStrokeWidthSlider;
            var gammaSlider;
            var $event = $({});
            var isRefreshing = false;

            function init() {
                viewer.viewerNodes.$imageTools.one('click', function () {
                    showPanel();
                    embedOnce();
                    hasBeenInitialized = true;
                });
                viewer.viewerNodes.$imageTools.on('click', showPanel);
            }

            function refresh() {
                if (hasBeenInitialized) {
                    isRefreshing = true;

                    lineSharpeningSlider.setValue(viewer.viewerControl.getSharpening() / 100);
                    svgStrokeWidthSlider.setValue(viewer.viewerControl.getSvgLineWidthMultiplier() / 100);

                    var gammaValue = viewer.viewerControl.getGamma();
                    if (gammaValue <= 1) {
                        gammaValue = gammaValue / 2;
                    } else {
                        gammaValue = (gammaValue * 10 + 90) / 2 / 100;
                    }
                    gammaSlider.setValue(gammaValue);

                    isRefreshing = false;
                }
            }

            function showPanel(e) {
                viewer.viewerNodes.$imageTools.addClass('pcc-active');
                var $imageToolsPanel = viewer.$dom.find('[data-pcc-image-tools-panel]');
                if ($imageToolsPanel.length > 0) {
                    $imageToolsPanel.css("display","block");
                    $(document).mouseup(hidePanel);
                }
            }

            function hidePanel(e) {
                var $imageToolsPanel = viewer.$dom.find('[data-pcc-image-tools-panel]');
                // if the target of the click isn't the image tools panel nor a descendant of the image tools panel
                if (!$imageToolsPanel.is(e.target) && $imageToolsPanel.has(e.target).length === 0) {
                    viewer.viewerNodes.$imageTools.removeClass('pcc-active');
                    $imageToolsPanel.css("display","none");
                    $(document).unbind('mouseup', hidePanel);
                }
            }

            function attachEvents() {
                var debouncedSharpening = _.debounce(viewer.viewerControl.setSharpening.bind(viewer.viewerControl), 30);
                lineSharpeningSlider.on('update', function(e, v) {
                    var roundedValue = Math.floor(v.value * 100);
                    viewer.$dom.find('[data-pcc-image-tools-slider-sharpening-value]').text(roundedValue);
                    if (!isRefreshing) {
                        debouncedSharpening(roundedValue);
                    }
                });

                var debouncedSvgStrokeWidthMultiplier = _.debounce(viewer.viewerControl.setSvgLineWidthMultiplier.bind(viewer.viewerControl), 30);
                svgStrokeWidthSlider.on('update', function(e, v) {
                    var roundedValue = Math.ceil(v.value * 100);
                    if (roundedValue < 1) {
                        roundedValue = 1;
                    }
                    viewer.$dom.find('[data-pcc-image-tools-slider-svg-stroke-value]').text(roundedValue);
                    if (!isRefreshing) {
                        debouncedSvgStrokeWidthMultiplier(roundedValue);
                    }
                });

                var debouncedGamma = _.debounce(viewer.viewerControl.setGamma.bind(viewer.viewerControl), 30);
                gammaSlider.on('update', function(e, v) {
                    var value = v.value * 100;
                    if (value <= 50) {
                        value = (value/10) * 2;
                    } else {
                        value = 2 * value - 90;
                    }
                    if (value > 100) {
                        value = 100;
                    }
                    value = value / 10;
                    var roundedValue = parseFloat(value.toFixed(1));
                    viewer.$dom.find('[data-pcc-image-tools-slider-gamma-value]').text(roundedValue);
                    if (!isRefreshing) {
                        debouncedGamma(roundedValue);
                    }
                });
            }

            function embedOnce() {
                lineSharpeningSlider = new Slider($("[data-pcc-slider=sharpening]")[0]);
                svgStrokeWidthSlider = new Slider($("[data-pcc-slider=svgStrokeWidth]")[0]);
                gammaSlider = new Slider($("[data-pcc-slider=gamma]")[0]);
                gammaSlider.move(defaultValue.gamma);
                $("#pcc-imageTools-slider-darkening-value").text('1');
                attachEvents();
            }

            function destroy() {
                if (!hasBeenInitialized) {
                    return;
                }
                viewer.viewerNodes.$imageTools.unbind('click', showPanel);
                lineSharpeningSlider.off('update');
                svgStrokeWidthSlider.off('update');
                gammaSlider.off('update');
                lineSharpeningSlider.destroy();
                svgStrokeWidthSlider.destroy();
                gammaSlider.destroy();

                hasBeenInitialized = false;
            }

            return {
                embedOnce: embedOnce,
                init: init,
                refresh: refresh,
                destroy: destroy,
                on: function(name, func){
                    $event.on(name, func);
                },
                off: function(name, func){
                    $event.off(name, func);
                }
            };

        })();

        // This module manages downloading the original file, as well as burning in redactions and signatures.
        var fileDownloadManager = (function(){
            var control, template, language,
                documentDisplayName = options.documentDisplayName || '',
                inPreviewMode = false,
                textSelection,
                currentViewerState = {},
                enableOptionsTimeout,
                // Retrieve the document name from the viewer initialization parameter
                originalName = options.documentDisplayName ? options.documentDisplayName.replace(/\..+$/, '') : 'file';

            function onTextSelected (ev) {
                textSelection = ev.textSelection;
            }

            function enableMarkOption(downloadOptions, availableMarkTypes, enable, otherOptionsAreEnabled, $el) {
                if (enable !== true) {
                    $el.addClass('pcc-disabled');
                    if (!otherOptionsAreEnabled) {
                        viewer.viewerNodes.$downloadAsDropdown.removeClass('pcc-disabled');
                    }
                }
                else {
                    $el.removeClass('pcc-disabled');
                }
            }

            function enableAvailableMarkOptions() {
                if (enableOptionsTimeout) {
                    clearTimeout(enableOptionsTimeout);
                    enableOptionsTimeout = undefined;
                }

                enableOptionsTimeout = setTimeout(function () {
                    // Disable the dropdowns if no marks of the type exist.
                    var downloadOptions = getOptions(viewer.viewerNodes.$downloadDialog);
                    var availableMarkTypes = getAvailableMarkTypes();
                    enableMarkOption(downloadOptions, availableMarkTypes, availableMarkTypes.annotation, downloadOptions.burnRedactions || downloadOptions.burnSignatures, viewer.viewerNodes.$downloadAnnotationsAsDropdown);
                    enableMarkOption(downloadOptions, availableMarkTypes, availableMarkTypes.redaction, downloadOptions.burnAnnotations || downloadOptions.burnSignatures, viewer.viewerNodes.$downloadRedactionsAsDropdown);
                    enableMarkOption(downloadOptions, availableMarkTypes, availableMarkTypes.signature, downloadOptions.burnRedactions || downloadOptions.burnAnnotations, viewer.viewerNodes.$downloadESignaturesAsDropdown);
                }, 100);
            }

            function init(viewerControl, downloadTemplate, languageOptions) {
                control = viewerControl;
                template = downloadTemplate;
                language = languageOptions;

                control.on(PCCViewer.EventType.TextSelected, onTextSelected);
                control.on(PCCViewer.EventType.MarkCreated, enableAvailableMarkOptions);
                control.on(PCCViewer.EventType.MarkRemoved, enableAvailableMarkOptions);

                bindFileDownloadManagerDOM();
            }

            function refresh() {
                viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadOriginalDocument);

                viewer.viewerNodes.$downloadAnnotationsAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadAnnotationsNone);
                viewer.viewerNodes.$downloadRedactionsAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadRedactionsNone);
                viewer.viewerNodes.$downloadESignaturesAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadESignaturesNone);

                var options = getOptions(viewer.viewerNodes.$downloadDialog);
                updateUIState(options);
                enableAvailableMarkOptions();
            }

            function onSuccessDownloadURL(url, $overlay, $overlayFade) {
                showOverlay($overlay, $overlayFade, { mode: 'complete' })
                .on('click', '.pcc-overlay-download', function(){
                    window.open(url);
                    hideOverlay($overlay, $overlayFade);
                })
                .on('click', '.pcc-overlay-cancel', function(ev) {
                    hideOverlay($overlay, $overlayFade);
                });
            }

            function onFailure(reason, originalOptions, $overlay, $overlayFade, retryFunction) {
                showOverlay($overlay, $overlayFade, { mode: 'error' })
                .on('click', '.pcc-overlay-retry', function(){
                    retryFunction(originalOptions, $overlay, $overlayFade);
                });
            }

            function burnMarkup(options, $overlay, $overlayFade) {
                var burnRequest, complete = false;

                showOverlay($overlay, $overlayFade, { mode: 'pending' })
                .on('click', '.pcc-overlay-cancel', function(ev) {
                    hideOverlay($overlay, $overlayFade);
                    if (burnRequest && burnRequest.cancel && !complete) {
                        burnRequest.cancel();
                    }
                });

                burnRequest = control.burnMarkup(options);
                burnRequest.then(function success(url){
                    complete = true;
                    onSuccessDownloadURL(url, $overlay, $overlayFade);
                }, function failure(reason){
                    complete = true;
                    // Check if the Promise was rejected due to a user cancel
                    if (reason.code !== "UserCancelled") {
                        onFailure(PCCViewer.Language.getValue("error." + reason.code), options, $overlay, $overlayFade, burnMarkup);
                    }
                });
            }

            function getAvailableMarkTypes() {
                var allMarks = control.getAllMarks(),
                    availableTypes = {},
                    type;

                _.forEach(allMarks, function(mark){
                    type = mark.getType();

                    if (type.match(/annotation/i) && mark.getVisible()) {
                        availableTypes.annotation = true;
                    } else if (type.match(/redaction/i) && mark.getVisible()) {
                        availableTypes.redaction = true;
                    } else if (type.match(/signature/i) && mark.getVisible()) {
                        availableTypes.signature = true;
                    }
                });

                return availableTypes;
            }

            function getMarksToBurn(options) {
                var marks = [];

                // Get marks to burn based on the options passed
                marks = _.filter(control.getAllMarks(), function(mark) {

                    if (mark.getType().match(/annotation/i)) {

                        if (options.burnAnnotations !== PCCViewer.Language.data.fileDownloadAnnotationsNone) {

                            // Filter annotations based on the data attribute
                            if (options.burnAnnotations === PCCViewer.Language.data.fileDownloadAnnotationsSelected) {
                                return mark.getData('Accusoft-burnAnnotation') === '1';
                            }

                            return true;
                        }

                        return false;
                    }

                    if (mark.getType().match(/redaction/i)) {
                        return options.burnRedactions !== PCCViewer.Language.data.fileDownloadRedactionsNone;
                    }

                    if (mark.getType().match(/signature/i)) {
                        return options.burnSignatures !== PCCViewer.Language.data.fileDownloadESignaturesNone;
                    }
                });

                return marks;
            }

            function hideOverlay($overlay, $overlayFade) {
                $overlay.html('').removeClass('pcc-open');
                $overlayFade.hide();

                // remove all event listeners
                $overlay.off();
            }

            function showOverlay($overlay, $overlayFade, templateOptions){
                templateOptions = templateOptions || {};
                templateOptions.mode = templateOptions.mode || 'select';
                templateOptions.language = language;

                $overlayFade.show();
                $overlay.html(_.template(template)({
                    options: templateOptions
                })).addClass('pcc-open')
                .on('click', '.pcc-overlay-closer', function(ev) {
                    hideOverlay($overlay, $overlayFade);
                });

                return $overlay;
            }

            function updateUIStateAndPreview() {
                if (inPreviewMode === true) {
                    var options = getOptions(viewer.viewerNodes.$downloadDialog);
                    updateMarksPreview(options);
                    updateImageToolsPreview(options);
                } else {
                    enableAvailableMarkOptions();
                }
            }

            function bindFileDownloadManagerDOM() {
                viewer.viewerNodes.$downloadDialog
                    .on('click', '[data-pcc-toggle-id="dropdown-download"]', function(ev) {
                        $(ev.target).parents('.pcc-select').find('.pcc-label').html($(ev.target).html());

                        if (viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').html() === PCCViewer.Language.data.fileDownloadOriginalDocument) {
                            viewer.viewerNodes.$downloadAnnotationsAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadAnnotationsNone);
                            viewer.viewerNodes.$downloadRedactionsAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadRedactionsNone);
                            viewer.viewerNodes.$downloadESignaturesAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadESignaturesNone);
                        }
                        updateUIStateAndPreview();
                    })
                    .on('click', '[data-pcc-toggle-id="dropdown-download-annotations"]', function(ev) {
                        $(ev.target).parents('.pcc-select').find('.pcc-label').html($(ev.target).html());

                        if (viewer.viewerNodes.$downloadAnnotationsAsDropdown.find('.pcc-label').html() !== PCCViewer.Language.data.fileDownloadAnnotationsNone) {
                            viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadPdfFormat);
                        }
                        updateUIStateAndPreview();
                    })
                    .on('click', '[data-pcc-toggle-id="dropdown-download-redactions"]', function(ev) {
                        $(ev.target).parents('.pcc-select').find('.pcc-label').html($(ev.target).html());

                        if (viewer.viewerNodes.$downloadRedactionsAsDropdown.find('.pcc-label').html() !== PCCViewer.Language.data.fileDownloadRedactionsNone) {
                            viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadPdfFormat);
                        }
                        updateUIStateAndPreview();
                    })
                    .on('click', '[data-pcc-toggle-id="dropdown-download-esignatures"]', function(ev) {
                        $(ev.target).parents('.pcc-select').find('.pcc-label').html($(ev.target).html());

                        if (viewer.viewerNodes.$downloadESignaturesAsDropdown.find('.pcc-label').html() !== PCCViewer.Language.data.fileDownloadESignaturesNone) {
                            viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').text(PCCViewer.Language.data.fileDownloadPdfFormat);
                        }
                        updateUIStateAndPreview();
                    });

                viewer.viewerNodes.$downloadDocumentPreview.on('click', function (ev) {
                    // Toggle preview mode.
                    var $this = $(this);

                    if (inPreviewMode === true) {
                        endPreview();
                    }
                    else {
                        inPreviewMode = !inPreviewMode;
                        $this.text(language.previewEnd);
                        viewer.$dom.addClass('pcc-preview-mode');
                        viewer.$dom.find('.pcc-tab-pane').hide();
                        viewer.$dom.find('.pcc-tab-preview').show();
                        viewer.viewerNodes.$selectText.addClass('pcc-disabled');
                        var options = getOptions(viewer.viewerNodes.$downloadDialog);
                        if (options.redactionOptions) {
                            var redactionViewMode = viewer.viewerControl.getRedactionViewMode();
                            if (options.redactionOptions.mode && options.redactionOptions.mode === 'draft'
                                && redactionViewMode === PCCViewer.RedactionViewMode.Normal) {
                                viewer.viewerControl.setRedactionViewMode(PCCViewer.RedactionViewMode.Draft);
                                viewer.viewerNodes.$redactionViewMode.addClass('pcc-active');
                            }
                        }
                        // Store viewer state.
                        storeViewerState(options);
                        updateImageToolsPreview(options);
                        viewer.setMouseTool({ mouseToolName: 'AccusoftPanAndEdit' });

                        if (textSelection) {
                            control.clearMouseSelectedText(textSelection);
                        }

                        control.clearSearch();
                    }
                });

                viewer.viewerNodes.$downloadDocument.on('click', function (ev) {
                    var options = getOptions(viewer.viewerNodes.$downloadDialog),
                        originalIsPdf = documentDisplayName.match(/.pdf$/i) !== null,
                        downloadOptions = {
                            marks: getMarksToBurn(options),
                            filename: originalName,
                            redactionOptions: options.redactionOptions
                        },
                        fileNameSuffixes = [];

                    // Add a suffix to the filename based on what we're adding to the burned document
                    _.each(options, function(val, opt) {
                        if (val) {
                            if (opt === 'burnAnnotations') {
                                if (val !== PCCViewer.Language.data.fileDownloadAnnotationsNone) {
                                    fileNameSuffixes.push('annotated');
                                }
                            } else if (opt === 'burnRedactions') {
                                if (val !== PCCViewer.Language.data.fileDownloadRedactionsNone) {
                                    fileNameSuffixes.push('redacted');
                                }
                            } else if (opt === 'burnSignatures') {
                                if (val !== PCCViewer.Language.data.fileDownloadESignaturesNone) {
                                    fileNameSuffixes.push('signed');
                                }
                            }
                        }
                    });

                    // Append the suffixes to the file name
                    if (fileNameSuffixes.length === 1) {
                        downloadOptions.filename = originalName + '-' + fileNameSuffixes[0];
                    } else if (fileNameSuffixes.length === 2) {
                        downloadOptions.filename = originalName + '-' + fileNameSuffixes.join('-and-');
                    } else if (fileNameSuffixes.length > 2) {
                        var lastSuffix = fileNameSuffixes.pop();
                        downloadOptions.filename = originalName + '-' + fileNameSuffixes.join('-') + '-and-' + lastSuffix;
                    }

                    if (fileNameSuffixes.length > 0) {
                        burnMarkup(downloadOptions, viewer.viewerNodes.$overlay, viewer.viewerNodes.$overlayFade);
                    } else if (options.downloadFormat === language.fileDownloadPdfFormat && !originalIsPdf) { // can't convert a PDF to a PDF
                        downloadOptions.targetExtension = 'pdf';
                        convert(downloadOptions, viewer.viewerNodes.$overlay, viewer.viewerNodes.$overlayFade);
                    } else if (options.downloadFormat === language.fileDownloadOriginalDocument || originalIsPdf) {
                        onSuccessDownloadURL(control.getDownloadDocumentURL(), viewer.viewerNodes.$overlay, viewer.viewerNodes.$overlayFade);
                    }
                });
            }

            var updateUIState = function (options) {
                if (options.burnAnnotations !== PCCViewer.Language.data.fileDownloadAnnotationsNone ||
                    options.burnRedactions !== PCCViewer.Language.data.fileDownloadRedactionsNone ||
                    options.burnSignatures !== PCCViewer.Language.data.fileDownloadESignaturesNone) {
                    viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').html(language.fileDownloadPdfFormat);
                    viewer.viewerNodes.$downloadAsDropdown.addClass('pcc-disabled');

                    options.downloadFormat = PCCViewer.Language.fileDownloadPdfFormat;
                } else if (
                    !(options.burnAnnotations !== PCCViewer.Language.data.fileDownloadAnnotationsNone ||
                    options.burnRedactions !== PCCViewer.Language.data.fileDownloadRedactionsNone ||
                    options.burnSignatures !== PCCViewer.Language.data.fileDownloadESignaturesNone)) {

                    viewer.viewerNodes.$downloadAsDropdown.removeClass('pcc-disabled');
                }
            };

            var getOptions = function($overlay) {

                var currentAnnotationDownloadMode = viewer.viewerNodes.$downloadAnnotationsAsDropdown.find('.pcc-label').html();
                var currentRedactionDownloadMode = viewer.viewerNodes.$downloadRedactionsAsDropdown.find('.pcc-label').html();
                var currentESignatureDownloadMode = viewer.viewerNodes.$downloadESignaturesAsDropdown.find('.pcc-label').html();

                var options = {
                    downloadFormat: viewer.viewerNodes.$downloadAsDropdown.find('.pcc-label').html(),
                    burnAnnotations: currentAnnotationDownloadMode,
                    burnRedactions: currentRedactionDownloadMode,
                    burnSignatures: currentESignatureDownloadMode,
                    redactionOptions: undefined
                };

                if (currentRedactionDownloadMode && currentRedactionDownloadMode === PCCViewer.Language.data.fileDownloadRedactionsDraft ) {
                    options.redactionOptions = { mode: 'draft' };
                }
                return options;
            };

            var convert = function(options, $overlay, $overlayFade) {

                var conversionRequest, complete = false;

                showOverlay($overlay, $overlayFade, { mode: 'pending' })
                    .on('click', '.pcc-overlay-cancel', function(ev) {
                        hideOverlay($overlay, $overlayFade);
                        if (conversionRequest && conversionRequest.cancel && !complete) {
                            conversionRequest.cancel();
                        }
                    });

                conversionRequest = control.requestDocumentConversion(options);

                conversionRequest.then(

                    function onResolve(urls){
                        complete = true;
                        // The options are set so that only a single file is output during the conversion, so request the first URL when saving the converted file.
                        onSuccessDownloadURL(urls[0], $overlay, $overlayFade);
                    },

                    function onReject(reason){
                        complete = true;
                        if (reason.code !== "UserCancelled") {
                            onFailure(PCCViewer.Language.getValue("error." + reason.code), options, $overlay, $overlayFade, convert);
                        }
                    }
                );
            };

            function endPreview() {
                var redactionViewMode = viewer.viewerControl.getRedactionViewMode();
                if (redactionViewMode === PCCViewer.RedactionViewMode.Draft) {
                  viewer.viewerControl.setRedactionViewMode(PCCViewer.RedactionViewMode.Normal);
                  viewer.viewerNodes.$redactionViewMode.removeClass('pcc-active');
                }

                viewer.viewerNodes.$downloadDialog.removeClass('pcc-download-preview');
                viewer.viewerNodes.$pageList.removeClass('pcc-download-preview');

                // Restore viewer state.
                restoreViewerState();

                inPreviewMode = !inPreviewMode;
                viewer.viewerNodes.$downloadDocumentPreview.text(language.preview);
                viewer.$dom.removeClass('pcc-preview-mode');
                viewer.$dom.find('.pcc-tab-preview').hide();
                viewer.$dom.find('.pcc-tab-pane').show();
                if (viewer.documentHasText) {
                    // Enable text selection tools
                    viewer.viewerNodes.$selectText.removeClass('pcc-disabled');
                    viewer.viewerNodes.$highlightAnnotation.removeClass('pcc-disabled');
                    viewer.viewerNodes.$strikethroughAnnotation.removeClass('pcc-disabled');
                    viewer.viewerNodes.$hyperlinkAnnotation.removeClass('pcc-disabled');
                    viewer.viewerNodes.$textSelectionRedaction.removeClass('pcc-disabled');
                }
            }

            function storeViewerState(options) {
                currentViewerState['mouseTool'] = control.getCurrentMouseTool();
                currentViewerState['marksState'] = previewMarks(options);
                currentViewerState['sharpening'] = control.getSharpening();
                currentViewerState['gamma'] = control.getGamma();
                currentViewerState['svgLineWidthMultiplier'] = control.getSvgLineWidthMultiplier();
            }

            function previewMarks(options) {
                var burnRedactions = PCCViewer.Language.data.fileDownloadRedactionsNone,
                    burnSignatures = PCCViewer.Language.data.fileDownloadESignaturesNone,
                    burnAnnotations = PCCViewer.Language.data.fileDownloadAnnotationsNone,
                    burnOnlyChosenAnnotations = false;

                viewer.viewerNodes.$downloadDialog.addClass('pcc-download-preview');
                viewer.viewerNodes.$pageList.addClass('pcc-download-preview');

                if (options.downloadFormat === 'PDF') {
                    burnRedactions = options.burnRedactions;
                    burnSignatures = options.burnSignatures;
                    burnAnnotations = options.burnAnnotations;
                    burnOnlyChosenAnnotations = options.burnAnnotations && (options.burnAnnotations === PCCViewer.Language.data.fileDownloadAnnotationsSelected);
                }

                // Loop through all marks and set their interaction mode to disable selection and hide them based on the
                // burn options specified by the user.
                var marksStateBeforePreview = {};
                var allMarks = control.getAllMarks();
                _.each(allMarks, function(mark) {
                    marksStateBeforePreview[mark.getId()] = { 'interactionMode': mark.getInteractionMode(), 'visible': mark.getVisible() };
                    mark.setInteractionMode(PCCViewer.Mark.InteractionMode.SelectionDisabled);

                    var category = (mark.getType().match(/redaction/i)) ? 'redactions' :
                                   (mark.getType().match(/signature/i)) ? 'signatures' : 'annotations';
                    switch (category) {
                        case 'redactions':
                            if (burnRedactions === PCCViewer.Language.data.fileDownloadRedactionsNone) {
                                mark.setVisible(false);
                            } else {
                                mark.setVisible(true);
                            }
                            break;
                        case 'signatures':
                            if (burnSignatures === PCCViewer.Language.data.fileDownloadESignaturesNone) {
                                mark.setVisible(false);
                            } else {
                                mark.setVisible(true);
                            }
                            break;
                        case 'annotations':
                            if (burnAnnotations === PCCViewer.Language.data.fileDownloadAnnotationsNone) {
                                mark.setVisible(false);
                            } else {
                                if (burnOnlyChosenAnnotations === true) {
                                    if (mark.getData('Accusoft-burnAnnotation') !== '1') {
                                        mark.setVisible(false);
                                    }
                                }
                            }
                            break;
                    }
                });

                // Return the previous state of the marks, so the interaction mode and visibility can be restored later.
                return marksStateBeforePreview;
            }

            function updateImageToolsPreview(options) {
                var burnSharpening = false;
                var burnSvgLineWidthMultiplier = false;
                var burnGamma = false;
                // Currently the following options will always be false, however, if we choose to support
                // burning in the Image Tools operations in the future, we'll need to selectively choose
                // which options to show during the download preview
                if (options.downloadFormat === 'PDF') {
                    burnSharpening = options.burnSharpening;
                    burnSvgLineWidthMultiplier = options.burnSvgLineWidthMultiplier;
                    burnGamma = options.burnGamma;
                }

                if (burnSharpening !== true) {
                    viewer.viewerControl.setSharpening(0);
                }

                if (burnGamma !== true) {
                    viewer.viewerControl.setGamma(1);
                }

                if (burnSvgLineWidthMultiplier !== true) {
                    viewer.viewerControl.setSvgLineWidthMultiplier(1);
                }
            }

            function updateMarksPreview(options) {
                var burnRedactions = PCCViewer.Language.data.fileDownloadRedactionsNone,
                    burnSignatures = PCCViewer.Language.data.fileDownloadESignaturesNone,
                    burnAnnotations = PCCViewer.Language.data.fileDownloadAnnotationsNone,
                    burnOnlyChosenAnnotations = false;

                if (options.downloadFormat === 'PDF') {
                    burnRedactions = options.burnRedactions;
                    burnSignatures = options.burnSignatures;
                    burnAnnotations = options.burnAnnotations;
                    burnOnlyChosenAnnotations = options.burnAnnotations && (options.burnAnnotations === PCCViewer.Language.data.fileDownloadAnnotationsSelected);
                }

                // Loop through all marks and hide or show them based on the burn options specified by the user and the current state
                // (marks that were hidden before entering preview mode should not be made visible).
                var marksStateBeforePreview = currentViewerState['marksState'];
                var allMarks = control.getAllMarks();
                _.each(allMarks, function(mark) {
                    var category = (mark.getType().match(/redaction/i)) ? 'redactions' :
                                   (mark.getType().match(/signature/i)) ? 'signatures' : 'annotations';
                    switch (category) {
                        case 'redactions':
                            if (burnRedactions === PCCViewer.Language.data.fileDownloadRedactionsNone) {
                                mark.setVisible(false);
                            }
                            else if (marksStateBeforePreview[mark.getId()].visible === true) {
                                if (burnRedactions === PCCViewer.Language.data.fileDownloadRedactionsNormal) {
                                    viewer.viewerControl.setRedactionViewMode(PCCViewer.RedactionViewMode.Normal);
                                } else if (burnRedactions === PCCViewer.Language.data.fileDownloadRedactionsDraft) {
                                    viewer.viewerControl.setRedactionViewMode(PCCViewer.RedactionViewMode.Draft);
                                }
                                mark.setVisible(true);
                            }
                            break;
                        case 'signatures':
                            if (burnSignatures === PCCViewer.Language.data.fileDownloadESignaturesNone) {
                                mark.setVisible(false);
                            }
                            else if (marksStateBeforePreview[mark.getId()].visible === true) {
                                mark.setVisible(true);
                            }
                            break;
                        case 'annotations':
                            if (burnAnnotations !== PCCViewer.Language.data.fileDownloadAnnotationsNone) {
                                if (burnOnlyChosenAnnotations === true) {
                                    if (mark.getData('Accusoft-burnAnnotation') !== '1') {
                                        mark.setVisible(false);
                                    }
                                    else if (marksStateBeforePreview[mark.getId()].visible === true) {
                                        mark.setVisible(true);
                                    }
                                }
                                else if (marksStateBeforePreview[mark.getId()].visible === true) {
                                    mark.setVisible(true);
                                }
                            }
                            else {
                                mark.setVisible(false);
                            }
                            break;
                    }
                });
            }

            function restoreViewerState() {
                // Restore mouse tool state.
                viewer.setMouseTool({ mouseToolName: currentViewerState['mouseTool'] });

                // Restore mark interaction mode and visibility.
                var marksState = currentViewerState['marksState'];
                _.each(marksState, function(markState, markId){
                    var mark = control.getMarkById(markId);
                    mark.setInteractionMode(markState.interactionMode);
                    mark.setVisible(markState.visible);
                });

                // Execute search again to redraw highlights.
                viewer.search.executeSearch(true, true);
                control.setSharpening(currentViewerState['sharpening']);
                control.setGamma(currentViewerState['gamma']);
                control.setSvgLineWidthMultiplier(currentViewerState['svgLineWidthMultiplier']);
                currentViewerState = {};
            }

            function isInPreviewMode() {
                return inPreviewMode;
            }

            return {
                init: init,
                refresh: refresh,
                enableAvailableMarkOptions: enableAvailableMarkOptions,
                endPreview: endPreview,
                isInPreviewMode: isInPreviewMode
            };
        })();

        // This module manages displaying and navigating attachments.
        var attachmentManager = (function(){
            var control, language, initialized;
            var $attachmentsPanel, $currentEmail, $returnToPrevEmail, $attachmentList, $attachmentsBadge;
            var emailsStack = [];
            var currentDocument = { viewingSessionId: options.documentID };

            function init(viewerControl, languageOptions) {
                control = viewerControl;
                language = languageOptions;
                $attachmentsPanel = viewer.$dom.find('[data-pcc-attachments-panel]');
                $currentEmail = $attachmentsPanel.find('.pcc-attachments-current-email');
                $returnToPrevEmail = $attachmentsPanel.find('.pcc-attachments-to-prev-email');
                $attachmentList = $attachmentsPanel.find('[data-pcc-attachments-panel-list]');
                $attachmentsBadge = viewer.viewerNodes.$attachments.find('.pcc-icon-badge');
                updateIcon($returnToPrevEmail.find('.pcc-icon'));

                $currentEmail.on('click', function() {
                    changeCurrentDocument(getCurrentEmail());
                });
                $returnToPrevEmail.on('click', function() {
                    if (emailsStack.length > 1) {
                        emailsStack.pop();
                        changeCurrentDocument(getCurrentEmail());
                    }
                });

                control.on(PCCViewer.EventType.PageCountReady, loadAttachmentList);
                viewer.viewerNodes.$attachments.on('click', showPanel);

                if (options.attachmentViewingMode !== viewer.attachmentViewingModeEnum.ThisViewer) {
                    $attachmentsPanel.find('.pcc-attachments-section-current-email').addClass('pcc-hide');
                }
            };

            // This function executes an API request to fetch the list of attachments of the current document.
            var loadAttachmentList = function () {
                viewer.viewerControl.loadAttachments().then(
                    // success:
                    function (attachments) {
                        if (!initialized) {
                            initialized = true;
                            changeCurrentDocument(currentDocument);
                            if (attachments.length) {
                                viewer.viewerNodes.$attachments.removeClass('pcc-hide');
                            }
                        }
                        if (attachments.length || documentIsEmail(currentDocument)) {
                            updateAttachmentsList(attachments);
                        }
                    },
                    // failure:
                    function (reason) {
                        viewer.notify({
                            message: language.attachments.failedToLoad
                        });
                    });
            };

            var updateAttachmentsList = function(attachments) {
                // update list title with attachments count
                var attachmentsListTitle = viewer.$dom.find('[data-pcc-attachments-panel-list-title]');
                attachmentsListTitle.text(language.attachments.title + ' (' + attachments.length + ')');
                $attachmentList.empty();
                if(attachments.length) {

                    $attachmentsBadge.text(attachments.length);
                    if (attachments.length > 9) {
                        $attachmentsBadge.addClass('pcc-icon-badge-wide');
                    } else {
                        if ($attachmentsBadge.hasClass('pcc-icon-badge-wide'))
                            $attachmentsBadge.removeClass('pcc-icon-badge-wide');
                    }
                    $attachmentsBadge.removeClass('pcc-hide');

                    var markupRecordTpl, markupRecord, domStrings = [];

                    if (options.attachmentViewingMode === viewer.attachmentViewingModeEnum.ThisViewer) {
                        markupRecordTpl = '<div class="pcc-row" data-pcc-attachment-id="{{ID}}" data-pcc-session-id="{{VIEWINGSESSIONID}}"><a class="pcc-attachments-attachment-name">{{DISPLAYNAME}}</a><span class="pcc-icon pcc-icon-check"></span></div>';
                    } else {
                        markupRecordTpl = '<div class="pcc-row" data-pcc-attachment-id="{{ID}}"><a class="pcc-attachments-attachment-name" href="?viewingSessionId={{VIEWINGSESSIONID}}" target="_blank" rel="noreferrer noopener">{{DISPLAYNAME}}</a></div>';
                    }

                    _.each(attachments, function(attachment, index){
                        markupRecord = markupRecordTpl.replace('{{ID}}', index)
                            .replace('{{VIEWINGSESSIONID}}', attachment.viewingSessionId)
                            .replace('{{DISPLAYNAME}}', attachment.displayName);

                        domStrings.push(markupRecord);
                    });

                    if (domStrings.length) {
                        $attachmentList.append(domStrings.join('\n'));
                        $attachmentList.find('.pcc-row').click(function(ev) {
                            hidePanel();
                            if (options.attachmentViewingMode === viewer.attachmentViewingModeEnum.ThisViewer) {
                                var attachmentSessionId = ev.delegateTarget.getAttribute('data-pcc-session-id');
                                var attachmentName = ev.delegateTarget.textContent;
                                changeCurrentDocument({
                                    viewingSessionId: attachmentSessionId,
                                    name: attachmentName
                                });
                            }
                        });
                    } else {
                        viewer.notify({
                            message: language.attachments.failedToLoad
                        });
                    }
                } else {
                    if (!$attachmentsBadge.hasClass('pcc-hide')) {
                        $attachmentsBadge.addClass('pcc-hide');
                    }
                }
                parseIcons($attachmentList);
            };

            var getCurrentEmail = function() {
                return emailsStack[emailsStack.length - 1];
            };

            var documentIsEmail = function(document) {
                return document.name
                    ? document.name.slice(-4).toLowerCase() === '.eml'
                    : /*primary email*/ true;
            };

            var changeCurrentDocument = function(document) {
                if (documentIsEmail(document)) {
                    if (getCurrentEmail() !== document) {
                        emailsStack.push(document);
                    }

                    var currentEmailName = document.name || language.attachments.primaryEmail;
                    $currentEmail
                        .find('.pcc-attachments-current-email-name')
                        .text(currentEmailName);
                    $currentEmail.addClass('pcc-active');
                    updateReturnToPrecEmailState();
                }

                currentDocument = document;
                var viewingSessionId = document.viewingSessionId;
                viewer.viewerControl.changeViewingSession(viewingSessionId, true);

                // Highlight current document
                $attachmentList.find('.pcc-row').removeClass('pcc-active');
                if (getCurrentEmail().viewingSessionId === viewingSessionId) {
                    $currentEmail.addClass('pcc-active');
                } else {
                    $currentEmail.removeClass('pcc-active');
                    $attachmentList
                        .children('.pcc-row[data-pcc-session-id="' + viewingSessionId + '"]')
                        .addClass('pcc-active');
                }
                $attachmentsBadge.addClass('pcc-hide');
                hidePanel();
            };

            var updateReturnToPrecEmailState = function() {
                // Update return to previous email status
                if (emailsStack.length > 1) {
                    $returnToPrevEmail.removeClass('pcc-disabled');
                } else {
                    $returnToPrevEmail.addClass('pcc-disabled');
                }
            };

            function showPanel() {
                viewer.viewerNodes.$attachments.addClass('pcc-active');
                if ($attachmentsPanel.length > 0) {
                    $attachmentsPanel.css("display","block");
                    const desirableLeftOffset = 185;
                    const overflow = $(window).width() - (desirableLeftOffset + $attachmentsPanel[0].offsetWidth);
                    if (overflow < 0) {
                        $attachmentsPanel.css('left', desirableLeftOffset + overflow + 'px');
                    } else {
                        $attachmentsPanel.css('left', desirableLeftOffset + 'px');
                    }
                    $(document).mouseup(hidePanel);
                }
            }

            function hidePanel(e) {
                // if the target of the click isn't the attachments panel nor a descendant of the attachments panel
                if (!e || (!$attachmentsPanel.is(e.target) && $attachmentsPanel.has(e.target).length === 0)) {
                    viewer.viewerNodes.$attachments.removeClass('pcc-active');
                    $attachmentsPanel.css("display","none");
                    $(document).unbind('mouseup', hidePanel);
                }
            }

            return {
                init: init
            };
        })();

        // Image Stamp module
        this.imageStamp = (function () {
            var stampApi,
                imageStampList,
                imageStampListTimestamp = 0,
                imageStampListTtl = 10 * 60, // 10 minutes
                imageStampMruTime = 0,
                sortByOptions = [PCCViewer.Language.data.imageStampSortByRecentlyUsed, PCCViewer.Language.data.imageStampSortByFileName],
                sortKey = 'recentlyUsedTime',
                sortName = sortByOptions[0],
                sortOrder = 'desc',
                annotationTool,
                redactionTool,
                noop = function(){},
                imageStampDataMap = {},
                $event = $({}),
                $overlay,
                $toolButtons;

            var init = function (viewerNodes) {
                stampApi = new PCCViewer.ImageStamps(options);

                annotationTool = PCCViewer.MouseTools.getMouseTool('AccusoftImageStampAnnotation');
                redactionTool = PCCViewer.MouseTools.getMouseTool('AccusoftImageStampRedaction');
                $toolButtons = $('[data-pcc-mouse-tool="AccusoftImageStampAnnotation"], [data-pcc-mouse-tool="AccusoftImageStampRedaction"]');

                $overlay = viewerNodes.$imageStampOverlay;

                attachListeners();

                // this will initialize the image list and the mouse tools
                initImageStampMouseTools();
            };

            var refresh = function () {
                annotationTool = PCCViewer.MouseTools.getMouseTool('AccusoftImageStampAnnotation');
                redactionTool = PCCViewer.MouseTools.getMouseTool('AccusoftImageStampRedaction');
                initImageStampMouseTools();
            };

            var initImageStampMouseTools = function(){
                loadStampList(function(list){
                    var mostRecentImage,
                        mostRecentTime = Number.NEGATIVE_INFINITY;

                    // transform the stored list into a lookup object
                    var storedList = _.reduce(storageGetImageStampList().imageStampList.imageStamps, function(seed, el){
                        seed[el.id] = el;
                        return seed;
                    }, {});

                    _.forEach(list.imageStamps, function(el) {
                        // overwrite most recently used time with the time from the previously stored list if necessary
                        var localObj = storedList[el.id];
                        if (localObj && localObj.recentlyUsedTime > el.recentlyUsedTime) {
                            el.recentlyUsedTime = localObj.recentlyUsedTime;
                        }

                        // find the most recently used image
                        if (el.recentlyUsedTime > mostRecentTime) {
                            mostRecentTime = el.recentlyUsedTime;
                            mostRecentImage = el;
                        }
                    });

                    if (mostRecentImage) {
                        requestImageData(mostRecentImage, function(err, response){
                            if (err) {
                                $toolButtons.attr('disabled', 'disabled');
                                return;
                            }

                            setToolsImage({
                                dataUrl: response.dataUrl,
                                id: response.dataHash
                            });

                            $toolButtons.removeAttr('disabled');
                        });
                    } else {
                        $toolButtons.attr('disabled', 'disabled');
                    }

                    storeImageStampList();
                });
            };

            var requestImageData = function(image, done){
                done = (typeof done === 'function') ? done : noop;

                if (imageStampDataMap[image.id]) {
                    // this image exists, so use the same data
                    done(undefined, imageStampDataMap[image.id].data);
                    return;
                }

                // we did not find existing image data, so request it
                stampApi.requestImageSourceBase64(image.id).then(function(response){
                    // save this image in the hash of known images
                    imageStampDataMap[image.id] = {
                        data: response,
                        image: image
                    };

                    done(undefined, response);
                }, function fail(reason){
                    done(PCCViewer.Language.getValue("error." + reason.code));
                });
            };

            var setToolsImage = function(newImage){
                // set both mouse tools to use the same image
                annotationTool.getTemplateMark().setImage(newImage);
                redactionTool.getTemplateMark().setImage(newImage);
            };

            var attachListeners = function () {
                $overlay.on('click', '.pcc-image-stamp-list-item', function (ev) {
                    ev.stopPropagation();
                    ev.preventDefault();

                    itemSelectionHandler(this);
                });

                $overlay.on('click', '[data-pcc-image-stamp=closer]', function (ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    hideOverlay();
                });

                $overlay.on('click', '[data-image-stamp-sort-item]', function (ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    sortSelectionHandler(this);
                });
            };

            // Launch image stamp selection modal
            var showOverlay = function () {
                // show the overlay immediately in "loading" mode
                drawOverlay({
                    waiting: true
                });

                loadStampList(function done(list){
                    sortList();
                    // update the overlay to show the new data
                    drawOverlay({
                        waiting: false
                    });
                });

                $overlay.addClass('pcc-open');

                // Show the dark overlay
                viewer.viewerNodes.$overlayFade.show();
            };

            var drawOverlay = function (params) {
                $overlay.html(_.template(options.template.imageStampOverlay)(_.extend({
                    waiting: params.waiting,
                    imageStampList: imageStampList,
                    sortBy: sortByOptions,
                    sortKey: sortKey,
                    sortName: sortName,
                    sortOrder: sortOrder
                }, PCCViewer.Language.data)));
            };

            var hideOverlay = function () {
                $overlay.removeClass('pcc-open');

                $event.off('imageSelect');

                // Remove the dark overlay
                viewer.viewerNodes.$overlayFade.hide();
            };

            var storeImageStampList = function () {
                if (localStorage && imageStampList && imageStampListTimestamp) {
                    var storageObj = {
                        imageStampList: imageStampList,
                        imageStampListTimestamp: imageStampListTimestamp
                    };

                    localStorage.setItem('pccvImageStampList', JSON.stringify(storageObj));
                }
            };

            var storageGetImageStampList = function () {
                if (localStorage) {
                    var storageObj = JSON.parse(localStorage.getItem('pccvImageStampList'));

                    if (storageObj) {
                        _.each(storageObj.imageStampList.imageStamps, function (imageStamp) {
                        if (imageStamp.recentlyUsedTime > imageStampMruTime) {
                            imageStampMruTime = imageStamp.recentlyUsedTime;
                        }
                    });

                        return storageObj;
                }
                }

                // return an empty list if nothing was found in local storage
                return {
                    imageStampList: { imageStamps: [] },
                    imageStampListTimestamp: 0
                };
            };

            var itemSelectionHandler = function (itemEl) {
                var stampId = $(itemEl).attr('data-image-stamp-id');

                var imageObj = _.find(imageStampList.imageStamps, function (imageStamp) {
                    return imageStamp.id === stampId;
                });

                imageObj.recentlyUsedTime = imageStampMruTime = Math.round((new Date()).getTime() / 1000);
                storeImageStampList();

                requestImageData(imageObj, function(err, response){
                    if (err) {
                        viewer.notify({
                            message: PCCViewer.Language.data.imageStampUnableToLoadImage
                        });

                        hideOverlay();
                        return;
                    }

                    // trigger and imageSelect event
                    $event.trigger('imageSelect', {
                        dataUrl: response.dataUrl,
                        id: response.dataHash
                    });

                    hideOverlay();
                });
            };

            var sortSelectionHandler = function (sortEl) {
                sortName = $(sortEl).data('image-stamp-sort-item');

                switch (sortName) {
                    case PCCViewer.Language.data.imageStampSortByRecentlyUsed:
                        if (sortKey === 'recentlyUsedTime') {
                            sortOrder = (sortOrder === 'desc') ? 'asc' : 'desc';
                        } else {
                            sortOrder = 'desc';
                        }
                        sortKey = 'recentlyUsedTime';
                        break;

                    case PCCViewer.Language.data.imageStampSortByFileName:
                        if (sortKey === 'displayName') {
                            sortOrder = (sortOrder === 'desc') ? 'asc' : 'desc';
                        }
                        sortKey = 'displayName';
                        break;
                }

                sortList();

                drawOverlay({
                    waiting: false
                });
            };

            var sortList = function () {
                if ((sortKey === 'recentlyUsedTime' && imageStampMruTime === 0) ||
                        typeof sortName === 'undefined' ||
                        typeof sortOrder === 'undefined') {
                    return;
                }

                if (sortKey) {
                    imageStampList.imageStamps = _.sortBy(imageStampList.imageStamps, sortKey);
                }

                if (sortOrder === 'desc') {
                    imageStampList.imageStamps = imageStampList.imageStamps.reverse();
                }
            };

            var loadStampList = function (done) {
                done = (typeof done === 'function') ? done : noop;

                var now = Math.round((new Date()).getTime() / 1000);

                // check to see if cached list has expired
                if (imageStampListTimestamp + imageStampListTtl > now) {
                    done(imageStampList);
                    $toolButtons.removeAttr('disabled');
                } else {
                    stampApi.requestImageStampList().then(
                        //success
                        function (listResponse) {
                            imageStampList = listResponse;

                            if (imageStampList.imageStamps.length === 0) {
                                $toolButtons.attr('disabled', 'disabled');
                                return;
                            }

                            imageStampListTimestamp = Math.round((new Date()).getTime() / 1000);

                            _.each(imageStampList.imageStamps, function (imageStampObj, index) {
                                imageStampList.imageStamps[index].url = stampApi.getImageSourceURL(imageStampObj.id);
                                imageStampList.imageStamps[index].recentlyUsedTime = 0;
                            });

                            done(imageStampList);
                            $toolButtons.removeAttr('disabled');
                        },
                        //failure
                        function (reason) {
                            viewer.notify({
                                message: PCCViewer.Language.data.imageStampUnableToLoad
                            });
                            $toolButtons.attr('disabled', 'disabled');
                        }
                    );
                }
            };

            var getImageUrl = function(imageObject){
                return imageObject.dataUrl;
            };

            var selectToolImage = function(done){
                done = (typeof done === 'function') ? done : noop;

                $event.one('imageSelect', function(ev, data){
                    setToolsImage(data);
                    done(data);
                });

                showOverlay();
            };

            var selectMarkImage = function(done){
                done = (typeof done === 'function') ? done : noop;

                $event.one('imageSelect', function(ev, data){
                    done(data);
                });

                showOverlay();
            };

            return {
                init: init,
                refresh: refresh,
                getImageUrl: getImageUrl,
                selectToolImage: selectToolImage,
                selectMarkImage: selectMarkImage
            };
        })();

        this.thumbnailManager = (function(){
            var control, thumbControl,
                $dom, $handle, $container, $viewer, $slider,
                isInitialized = false,
                isEmbedded = false,
                pageChangeTimeout,
                debouncedResize,
                minContainerWidth,
                marginOffset = 0,
                lastWidth,
                $event = $({}),
                latestKnownBreakpoint = viewer.latestBreakpoint,
                sizeClasses = ['pcc-thumbnails-small', 'pcc-thumbnails-medium', 'pcc-thumbnails-large'];

            onWindowResize(function(){
                if (!isEmbedded || viewer.latestBreakpoint === latestKnownBreakpoint) { return; }

                // The viewport has changed states, so we need some DOM cleanup.
                // Update the breakpoint tracker and reset the drag to resize handlers.
                latestKnownBreakpoint = viewer.latestBreakpoint;
                resetResizeHandler();

                if (viewer.latestBreakpoint !== viewer.breakpointEnum.mobile) {
                    // We need to re-enable dragging to resize in this case.
                    minContainerWidth = calculateMinContainerSize();
                    initResizeHandler();
                }
            });

            function getDOMRect($elem) {
                var rect = $elem.get(0).getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width || rect.right - rect.left,
                    height: rect.height || rect.bottom - rect.top
                };
            }

            function getDOMWidth($elem) {
                // We cannot trust jQuery width when using a border-box box model.
                // Instead, we will use the bounding rectangle of the DOM element.
                return getDOMRect($elem).width;
            }

            function setDOMWidth($elem, width) {
                // We cannot trust jQuery to set width either, because it accounts
                // for offsets that we do not want it accounting for.
                var elem = $elem.get(0);
                elem.style.width = width + 'px';
            }

            function getPageToFocus(){
                var currentlyVisible = thumbControl.getVisiblePages(),
                    currentlySelected = thumbControl.getSelectedPages(),
                    pageToFocus;

                _.forEach(currentlyVisible, function(val){
                    if (!pageToFocus && _.contains(currentlySelected, val)) {
                        pageToFocus = val;
                    }
                });

                if (!pageToFocus) {
                    pageToFocus = currentlyVisible[0];
                }

                return pageToFocus || undefined;
            }

            function maintainVisibleState(updateFunc){
                var pageToFocus = getPageToFocus();

                updateFunc();

                if (pageToFocus) {
                    thumbControl.scrollTo(pageToFocus, { forceAlignTop: true });
                }
            }

            function onThumbnailSelectionChanged(ev) {
                if (ev.pageNumbers && ev.pageNumbers.length === 1) {
                    // go to the selected page if there is only one selected
                    control.setPageNumber(ev.pageNumbers[0]);
                }
            }

            function onSetSelectedPages(ev) {
                var pageNum = ev.pageNumber,
                func = function () {
                    thumbControl.setSelectedPages(pageNum);
                };
                if (ev.pageNumber) {
                    if (pageChangeTimeout) {
                        clearTimeout(pageChangeTimeout);
                        pageChangeTimeout = undefined;
                    }
                    pageChangeTimeout = setTimeout(func, 300);
                }
            }

            function onViewingSessionChanged() {
                thumbControl.setSelectedPages(control.pageNumber);
            }

            function calculateMinContainerSize(){
                // Figure out the minimum size based on the first thumbnail size,
                // and allow for extra room to handle the scroll bar nad drag handle.
                return getDOMWidth( $dom.children().first() ) + marginOffset;
            }

            function resizeContainerTo(width, fireEvent) {
                fireEvent = !!fireEvent;

                setDOMWidth($container, width);
                lastWidth = width;

                // We changed the container size, so also resize the slider. This is
                // reazonably cheap, so we can do it in every resize for a better
                // animation.
                $slider.api.resize();

                if (fireEvent) {
                    $event.trigger('resize', {
                        width: lastWidth
                    });
                }
            }

            function initResizeHandler(){
                var containerRect,
                    viewerRect,
                    startClient = { x: 0, y: 0 },
                    pageToFocus, scrollHeight;

                var onStart = function(ev, params){
                    containerRect = getDOMRect($container);
                    viewerRect = getDOMRect($viewer);
                    startClient.x = params.clientX;
                    startClient.y = params.clientY;
                    pageToFocus = getPageToFocus();
                    scrollHeight = $dom.prop('scrollHeight');
                };
                var onMove = function(ev, params){
                    var deltaX = params.clientX - startClient.x;
                    var newWidth = Math.max(containerRect.width + deltaX, minContainerWidth),
                        newScrollHeight = $dom.prop('scrollHeight');

                    if (params.clientX > viewerRect.right) {
                        // Do not go beyond the viewer boundaries.
                        newWidth = viewerRect.right - containerRect.left;
                    }

                    if (newWidth !== lastWidth) {
                        resizeContainerTo(newWidth);
                    }

                    if (scrollHeight !== newScrollHeight) {
                        thumbControl.scrollTo(pageToFocus, { forceAlignTop: true });
                        scrollHeight = newScrollHeight;
                    }
                };
                var onEnd = function(ev, params){
                    thumbControl.reflow();

                    $event.trigger('resize', {
                        width: lastWidth
                    });
                };

                var destroyDrag = Drag($handle)
                    .init()
                    .on('start', onStart)
                    .on('move', onMove)
                    .on('end', onEnd)
                    .destroy;

                $event.one('reset', function(){
                    destroyDrag();
                });
            }

            function resetResizeHandler(){
                // remove any width that was set
                $container.width('');
                $event.trigger('reset');
            }

            function resizeSliderChange(ev, params){
                if (!$dom.hasClass(params.value)) {
                    maintainVisibleState(function(){

                        $dom.removeClass(sizeClasses.join(' ')).addClass(params.value);
                        thumbControl.reflow();
                        minContainerWidth = calculateMinContainerSize();

                        if (minContainerWidth > getDOMWidth($container)) {
                            resizeContainerTo(minContainerWidth, true);
                        }
                    });
                }
            }

            function attachEvents(){
                thumbControl.on(PCCViewer.ThumbnailControl.EventType.PageSelectionChanged, onThumbnailSelectionChanged);
                control.on(PCCViewer.EventType.PageChanged, onSetSelectedPages);
                control.on(PCCViewer.EventType.ViewingSessionChanged, onViewingSessionChanged);

                debouncedResize = onWindowResize(function(){
                    if (!isEmbedded) { return; }

                    thumbControl.reflow();
                });

                $slider.api.move(1).on('change', resizeSliderChange);

                initResizeHandler();
            }

            function detachEvents(){
                thumbControl.off(PCCViewer.ThumbnailControl.EventType.PageSelectionChanged, onThumbnailSelectionChanged);
                control.off(PCCViewer.EventType.PageChanged, onSetSelectedPages);
                control.off(PCCViewer.EventType.ViewingSessionChanged, onViewingSessionChanged);

                $(window).off('resize', debouncedResize);

                $slider.api.off('change', resizeSliderChange);
                $slider.api.destroy();

                resetResizeHandler();
            }

            function embedThumbnailControl(){
                thumbControl = new PCCViewer.ThumbnailControl($dom.get(0), control, viewer.viewerControlOptions);

                // attach events to interface between ViewerControl and ThumbnailControl
                attachEvents();
            }

            function destroy(){
                if (!isEmbedded) { return; }

                isEmbedded = false;
                detachEvents();
                thumbControl.destroy();
            }

            return {
                init: function(opts) {
                    control = opts.viewerControl;
                    $dom = $(opts.dom);
                    $container = $(opts.container);
                    $viewer = $(opts.viewer);
                    $handle = $container.find('[data-pcc-drag-handle]');
                    $slider = $container.find('[data-pcc-slider=thumb-size]');

                    if ($slider.length) {
                        $slider.api = Slider($slider.get(0), {
                            breaks: sizeClasses
                        });
                    }

                    isInitialized = true;
                },
                embedOnce: function() {
                    if (isEmbedded) { return; }
                    isEmbedded = true;

                    // embed the thumbnails
                    embedThumbnailControl();

                    // set the selection to the current page
                    thumbControl.setSelectedPages( control.getPageNumber() );

                    // this first call returns the size of the first thumbnail
                    minContainerWidth = calculateMinContainerSize();
                    // use the actual container width to figure out the size of the extra chrome
                    // we only need to calculate this once
                    marginOffset = getDOMWidth($container) - minContainerWidth;
                    // calculate the real minimum, now that we know the size of the extra space
                    minContainerWidth = calculateMinContainerSize();
                },
                destroy: destroy,
                on: function(name, func){
                    $event.on(name, func);
                },
                off: function(name, func){
                    $event.off(name, func);
                }
            };
        })();

        // Initialize the viewer
        viewer.initializeViewer();

        // Defines the public members returned by the Viewer
        var publicViewer = {
            // The main ViewerControl API for this Viewer instance
            viewerControl: viewer.viewerControl,

            // A method allowing the Viewer to be destroyed
            destroy: function () {
                viewer.search.clearSearch();
                viewer.search = undefined;

                // Destroy the ThumbnailControl
                viewer.thumbnailManager.destroy();
                viewer.thumbnailManager = undefined;

                viewer.destroy();

                // Destroy the eSignature module
                viewer.eSignature.destroy();
                viewer.eSignature = undefined;

                // destory the image tools dropdown module
                viewer.imageToolsDropdownUI.destroy();
                viewer.imageToolsDropdownUI = undefined;

                commentUIManager.destroy();
                commentUIManager = undefined;
                viewer.imageStamp = undefined;
                viewer.annotationIo = undefined;
                hyperlinkMenu = undefined;
                redactionReasonMenu = undefined;
                attachmentManager = undefined;
                immediateActionMenu = undefined;
                fileDownloadManager = undefined;
                viewer.annotationLayerSave = undefined;

                viewer = undefined;
            }
        };

        // Store the publicViewer object associated with the element. The same object can be accessed
        // later, so that the viewer can be destroyed.
        this.$dom.data(DATAKEY, publicViewer);
        this.$dom.trigger('ViewerReady', publicViewer);

        // Return the publicViewer object, so that the caller can access the ViewerControl and destroy() method..
        return publicViewer;
    }

    var animation = (function(){
        var list = {},
            frame,
            raf = window.requestAnimationFrame       ||
                  window.webkitRequestAnimationFrame ||
                  window.mozRequestAnimationFrame;

        var onNextFrame = function(){
            frame = undefined;

            _.forEach(list, function(func, key){
                if (func && typeof func === 'function') {
                    func();
                }
                list[key] = undefined;
            });
        };

        return {
            onUpdate: function(key, func) {
                // execute immediately in browsers that do not support requestAnimationFrame
                if (!raf) {
                    func();
                    return;
                }

                // assing the function to the queue object
                list[key] = func;

                // request a frame is there isn't one pending
                if (!frame) {
                    frame = raf(onNextFrame);
                }
            }
        };
    })();

    var Drag = function(elem){
        var $elem = $(elem),
            $document = $(document),
            $event = $({}),
            startEvent = 'touchstart',
            moveEvent = 'touchmove',
            endEvent = 'touchend';

        if (window.navigator.pointerEnabled) {
            startEvent += ' pointerdown';
            moveEvent += ' pointermove';
            endEvent += ' pointerup';
            // this is required for the move events to be picked up correctly in IE using touch
            $elem.css('touch-action', 'none');
        } else if (window.navigator.msPointerEnabled) {
            startEvent += ' MSPointerDown';
            moveEvent += ' MSPointerMove';
            endEvent += ' MSPointerUp';
            $elem.css('touch-action', 'none');
        } else {
            startEvent += ' mousedown';
            moveEvent += ' mousemove';
            endEvent += ' mouseup';
        }

        function normalizeEvent(ev){
            if (ev.clientX && ev.clientY) {
                return ev;
            }

            if (ev.originalEvent.changedTouches) {
                ev.clientX = ev.originalEvent.changedTouches[0].clientX;
                ev.clientY = ev.originalEvent.changedTouches[0].clientY;
            } else if (/pointer/i.test(ev.type)) {
                ev.clientX = ev.originalEvent.clientX;
                ev.clientY = ev.originalEvent.clientY;
            }

            return ev;
        }

        function start(ev){
            ev = normalizeEvent(ev);
            ev.preventDefault();

            $document.on(moveEvent, move);
            $document.on(endEvent, end);

            $event.trigger('start', ev);
        }
        function move(ev){
            ev = normalizeEvent(ev);
            ev.preventDefault();

            animation.onUpdate('drag-move', function(){
                $event.trigger('move', ev);
            });
        }
        function end(ev){
            ev = normalizeEvent(ev);
            ev.preventDefault();

            $document.off(moveEvent, move);
            $document.off(endEvent, end);

            animation.onUpdate('drag-end', function(){
                $event.trigger('end', ev);
            });
        }

        function init(){
            $elem.on(startEvent, start);
            return retValue;
        }
        function destroy(){
            $elem.off(startEvent, start);
        }

        var retValue = {
            on: function(name, func){
                $event.on(name, func);
                return retValue;
            },
            off: function(name, func){
                $event.off(name, func);
                return retValue;
            },
            init: init,
            destroy: destroy
        };

        return retValue;
    };

    var Slider = function(elem, opts){
        opts = opts || {};

        function getDOMRect(elem) {
            var rect = elem.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width || rect.right - rect.left,
                height: rect.height || rect.bottom - rect.top
            };
        }

        var track = elem.querySelector('.pcc-slider-track'),
            thumb = elem.querySelector('.pcc-slider-thumb'),
            trackRect = getDOMRect(track),
            length = trackRect.width || trackRect.right - trackRect.left,
            value = 0, valueName,
            $document = $(document),
            moveType = 'transform' in thumb.style ? 'transform' :
                       'webkitTransform' in thumb.style ? '-webkit-transform' :
                       'mozTransform' in thumb.style ? '-moz-transform' :
                       'msTransform' in thumb.style ? '-ms-transform' :
                       'oTransform' in thumb.style ? '-o-transform' : 'left',
            $event = $({}),
            destroyDrag = function(){},
            breaks;

        if (opts.breaks) {
            var boundInterval = 100 / opts.breaks.length,
                snapInterval = 100 / (opts.breaks.length - 1),
                fragment = document.createDocumentFragment(),
                snapPercent;

            breaks = _.map(opts.breaks, function(name, i){
                snapPercent = Math.ceil(snapInterval * i);

                fragment.appendChild( generateBreakElement(snapPercent) );

                return {
                    snapTo: snapPercent,
                    lowerBound: Math.ceil(boundInterval * i),
                    upperBound: Math.floor(boundInterval * (i+1)),
                    name: name
                };
            });

            track.appendChild(fragment);
        }

        function generateBreakElement(percent){
            var span = document.createElement('span');
            span.style.left = percent + '%';
            span.className = 'pcc-slider-break';
            return span;
        }

        function moveTo(percent) {
            value = percent;

            if (breaks) {
                var key = parseInt(percent * 100, 10),
                    breakObj = _.find(breaks, function(val){
                        return key >= val.lowerBound && key <= val.upperBound;
                    });

                percent = breakObj.snapTo / 100;
                valueName = breakObj.name;
            }

            var pixels = percent * length;

            if (moveType !== 'left') {
                thumb.style[moveType] = 'translateX(' + pixels + 'px)';
            } else {
                thumb.style.left = (pixels - 9) + 'px';
            }

            $event.trigger('update', { value: getValue() });

            return retValue;
        }

        function onStart(ev, params){
            trackRect = getDOMRect(track);
            length = trackRect.width;
        }
        function onMove(ev, params){
            var x = params.clientX,
                percent;

            if (x < trackRect.left) { percent = 0; }
            else if (x > trackRect.right) { percent = 1; }
            else {
                percent = (x - trackRect.left) / trackRect.width;
            }

            if (percent !== value) {
                moveTo(percent);
            }
        }
        function onEnd(ev, params){
            $event.trigger('change', { value: getValue() });
        }

        function click(ev){
            if ($(ev.target).is(thumb)) { return; }

            onStart(ev, ev);
            onMove(ev, ev);
            onEnd(ev, ev);
        }

        function init(){
            destroyDrag = Drag(thumb)
                .init()
                .on('start', onStart)
                .on('move', onMove)
                .on('end', onEnd)
                .destroy;

            $(elem).on('click', click);

            moveTo(0);
        }

        function destroy(){
            destroyDrag();
            destroyDrag = undefined;
            destroyDrag = function(){};

            $(elem).off('click', click);

            moveTo(0);
        }

        function getValue() {
            return valueName || value;
        }
        function setValue(val) {
            // if there are breaks, try to set based on break values
            if (breaks) {
                var breakObj = _.find(breaks, function(obj){
                    return obj.name === val;
                });

                if (breakObj) {
                    moveTo(breakObj.snapTo / 100);
                }
            }

            // try to set the value as a number
            if (typeof val === 'number') {
                moveTo(val);
            }

            $event.trigger('change', { value: getValue() });
        }

        function resize() {
            trackRect = getDOMRect(track);
            var newLength = trackRect.width;

            if (newLength !== length) {
                length = newLength;
                moveTo(value);
            }
        }

        var retValue = {
            move: moveTo,
            getValue: getValue,
            setValue: setValue,
            resize: resize,
            on: function(name, func){
                $event.on(name, func);
                return retValue;
            },
            off: function(name, func){
                $event.off(name, func);
                return retValue;
            },
            destroy: destroy
        };

        // initialize the slider
        init();

        return retValue;
    };

    var Queue = function(){
        var deferArray = [],
            running = false;

        function recursiveExecute(done) {
            // maintain scope
            (function recurse(){
                if (running && deferArray.length) {
                    var func = deferArray.shift();

                    // continue on the next event loop iteration
                    setTimeout(function(){
                        func(recurse);
                    }, 0);
                } else {
                    if (done && (typeof done === 'function')) {
                        done();
                    }
                }
            })();
        }

        this.push = function(func) {
            deferArray.push(function(cb){
                func();
                cb();
            });
        };

        this.run = function(done){
            running = true;
            recursiveExecute(done);
        };

        this.stop = function(){
            running = false;
            return deferArray;
        };

        this.isRunning = function(){
            return running;
        };
    };

    var ProximityDismiss = function(viewerDom){
        // generate a new instance every time this function is called
        // it needs access to the dom element in which the viewer is embedded
        return (function (){
            var globalOpts = {},
                onDismiss,
                proximityEnabled = false,
                firstMoveRecorded = false,
                noop = function(){};

            function distance(x0, y0, x1, y1) {
                var xs = x0 - x1,
                    ys = y0 - y1;

                return Math.sqrt((xs * xs) + (ys * ys));
            }

            function distanceToDom(x, y) {
                var rect = globalOpts.dom.getBoundingClientRect();
                var distX = 0,
                    distY = 0;

                // calc X offset
                if (x < rect.left) {
                    distX = rect.left - x;
                } else if(x > rect.left + rect.width) {
                    distX = x - (rect.left + rect.width);
                }

                // calc Y offset
                if (y < rect.top) {
                    distY = rect.top - y;
                } else if(y > rect.top + rect.height) {
                    distY = y - (rect.top + rect.height);
                }

                return Math.sqrt((distX * distX) + (distY * distY));
            }

            function trackMouse(ev){
                if (!globalOpts.dom) {
                    // the dom was already destroyed, so trigger a dismiss
                    onDismiss();
                    return;
                }

                if (!firstMoveRecorded) {
                    firstMoveRecorded = true;

                    // find the actual location of the menu, as it could be different on mobile
                    var rect = globalOpts.dom.getBoundingClientRect();

                    // if the menu is far away on the first move, we will track the actual menu point instead of the options control point
                    if (distance(ev.clientX, ev.clientY, rect.left, rect.top) > globalOpts.distanceTolerance) {
                        // The menu is far away from the mouse, so we will wait to enable proximity tracking. We will also use the
                        // actual menu location, and dismiss based on that.
                        globalOpts.controlX = rect.left;
                        globalOpts.controlY = rect.top;
                    } else {
                        // We are already close to the menu, so enable tracking by default. Use the original options point for tracking.
                        proximityEnabled = true;
                        globalOpts.controlX = globalOpts.clientX;
                        globalOpts.controlY = globalOpts.clientY;
                    }
                }

                if (ev.target === globalOpts.dom || $.contains(globalOpts.dom, ev.target)) {
                    // never destroy if the user is hovering over the menu itself
                    return;
                }

                var currentDistance;
                if (globalOpts.useDistanceToDomRect) {
                    currentDistance = distanceToDom(ev.clientX, ev.clientY);
                } else {
                    currentDistance = distance(ev.clientX, ev.clientY, globalOpts.controlX, globalOpts.controlY);
                }

                var isFarAway = currentDistance > globalOpts.distanceTolerance;

                // Send callback
                globalOpts.mouseMoveCallback({
                    currentDistance: currentDistance,
                    distanceTolerance: globalOpts.distanceTolerance,
                    dom: globalOpts.dom
                });

                // Set to true once the mouse moves close to the menu. Once set to true, it will never reset.
                // This way we start tracking only after they have moved close enough.
                proximityEnabled = proximityEnabled || !isFarAway;

                if (firstMoveRecorded && proximityEnabled && isFarAway) {
                    onDismiss({ type: 'move' });
                }
            }

            // keep track of window resizing and scrolling, so they can be trottled a bit
            var scrollTimeout,
                resizeTimeout,
                onScrollDismiss = function(){
                    onDismiss({ type: 'scroll' });
                };

            function trackScroll(){
                if (scrollTimeout) {
                    // don't register a new timeout if there is already one
                    return;
                }

                // dismiss in a short amount of time
                scrollTimeout = setTimeout(function(){
                    scrollTimeout = undefined;
                    onScrollDismiss();
                }, 100);
            }
            function trackResize(){
                if (scrollTimeout) {
                    clearTimeout(scrollTimeout);
                    scrollTimeout = undefined;
                }

                if (resizeTimeout) {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = undefined;
                }

                // Overload the dismiss function. On mobile devices, opening the keyboard will trigger
                // a scroll and page resize -- note, this happens on Android but not iOS. When scroll happens
                // together with a page resize, do not dismiss. It is most likely due to the touch keboard opening
                // on the device.
                var origOnScrollDismiss = onScrollDismiss;
                onScrollDismiss = noop;
                resizeTimeout = setTimeout(function(){
                    onScrollDismiss = origOnScrollDismiss;
                }, 800);
            }

            // keep track of the DOM element that will scroll, so we don't query for it multiple times
            // this will be the list of pages div
            var $scrollDom;

            function removeActiveListeners() {
                $(window).off('mousemove', trackMouse);
                $scrollDom.off('scroll', trackScroll);
                $(window).off('resize', trackResize);
                $(window).off('scroll', trackScroll);
                globalOpts = {};
                proximityEnabled = firstMoveRecorded = false;
                scrollTimeout = resizeTimeout = undefined;
                $scrollDom = undefined;
                onDismiss = undefined;
            }

            return {
                add: function(opts, dismissFunc){
                    $scrollDom = $(viewerDom).find('.pccPageListContainerWrapper');
                    globalOpts = _.extend({
                        // default is to use both triggers
                        useScrollTrigger: true,
                        useMoveTrigger: true,
                        useDistanceToDomRect: false,
                        mouseMoveCallback: noop,
                        distanceTolerance: 300
                    }, opts);
                    onDismiss = function(ev) {
                        dismissFunc(ev);
                    };

                    if (globalOpts.useDistanceToDomRect && !globalOpts.dom) {
                        throw Error('When useDistanceToDomRect is true, dom must be specified.');
                    }

                    // add events that will dismiss the menu
                    if (globalOpts.useMoveTrigger) {
                        $(window).on('mousemove', trackMouse);
                    }
                    if (globalOpts.useScrollTrigger) {
                        $scrollDom.on('scroll', trackScroll);
                        $(window).scroll(trackScroll);
                        $(window).on('resize', trackResize);
                    }
                },
                remove: function(){
                    removeActiveListeners();
                }
            };
        })();
    };

    function formatDate(date, template) {
        var hours = date.getHours(),
            period = (hours >= 12) ? 'pm' : 'am',
            adjustedHours = (hours > 12) ? hours - 12 : (hours === 0) ? 12 : hours,
            year = date.getFullYear().toString(),
            yearLength = year.length,
            shortYear = year.slice(yearLength - 2, yearLength);

        function padNumber(val) {
            val = val.toString();
            while(val.length < 2) {
                val = '0' + val;
            }
            return val;
        }

        return template.replace(/MM/, padNumber( date.getMonth() + 1 ))
                .replace(/M/, date.getMonth() + 1)
                .replace(/DD/, padNumber(date.getDate()))
                .replace(/D/, date.getDate())
                .replace(/YYYY/, year )
                .replace(/YY/, shortYear)
                .replace(/HH/, padNumber(hours))
                .replace(/H/, hours)
                .replace(/hh/, padNumber(adjustedHours))
                .replace(/h/, adjustedHours)
                .replace(/mm/, padNumber(date.getMinutes()))
                .replace(/m/, date.getMinutes())
                .replace(/a/, period)
                .replace(/A/, period.toUpperCase());
    }

    var fontLoader = (function(){
        var isLegacyBrowser = document.documentMode && document.documentMode === 8,
            fonts = {
            // Safe serif and sans-serif fonts
            'Times New Roman': { useInLegacy: true },
            'Arial': { useInLegacy: true },

            // Web fonts
            'Cedarville Cursive': { useInLegacy: false },
            'Dancing Script': { useInLegacy: true },

            'La Belle Aurore': { useInLegacy: false },
            'Sacramento': { useInLegacy: true },

            'Pacifico': { useInLegacy: true },
            'Italianno': { useInLegacy: true },

            'Grand Hotel': { useInLegacy: true },
            'Great Vibes': { useInLegacy: true }
        };

        function load(){
            // Create a preloader div
            var preloader = document.createElement('div'),
                style = preloader.style,
                div;

            // Make sure the preloader is reasonably hidden
            style.position = 'absolute';
            style.top = style.left = '0';
            style.width = style.height = '0px';
            // Note: do not set zIndex to 0, as that would cause some browsers not to preload

            _.each(returnNames(), function(name){
                // create a temporary div
                div = document.createElement('div');
                div.style.fontFamily = '"' + name + '"';

                // add it to the preloader
                preloader.appendChild(div);
            });

            // Append the preloader to the body
            document.body.appendChild(preloader);

            // Remove the preloader on the next event loop
            setTimeout(function(){
                document.body.removeChild(preloader);
            }, 0);
        }

        // Gets a list of all the fonts.
        function returnNames() {
            // filter out non-legacy fonts in legacy browsers
            return _.filter(_.keys(fonts), function(el){
                return !isLegacyBrowser  || fonts[el].useInLegacy;
            });
        }

        return {
            preLoad: load,
            names: returnNames,
            isLegacyBrowser: isLegacyBrowser
        };
    })();

    // This module manages the localStorage for signatures.
    // It populates the global, shared PCCViewer.Signatures collection
    var localSignatureManager = (function () {
        var hasLocalStorage = (window.localStorage &&
                               window.localStorage.getItem &&
                               window.localStorage.setItem &&
                               window.localStorage.removeItem);

        // the key to use in local storage
        var signatureStorageKey = 'pccvSignatures';
        // create a new non-blocking queue to load saved signatures
        var loadQueue = new Queue();

        function signatureAdded(){
            // overwrite signatures with PCCViewer.Signatures collection
            setStoredSignatures(PCCViewer.Signatures.toArray());
        }

        function signatureRemoved(){
            // overwrite signatures with PCCViewer.Signatures collection
            var signatureArr = PCCViewer.Signatures.toArray();
            setStoredSignatures(signatureArr);
        }

        var destroy = function() {
            if (loadQueue && loadQueue.isRunning()) {
                loadQueue.stop();
            }
        };

        var loadStoredSignatures = function () {
            var signatures = getStoredSignatures();

            var tempCount = signatures.length;

            while(tempCount--) {
                // Make sure this loop does not block the UI if there are a lot of signatures,
                // just in case. Also, ignore possible errors of generating functions inside a loop,
                // we need to queue up individual functions.
                /* jshint -W083 */
                loadQueue.push(function(){
                    if (signatures.length) {
                        var value = signatures.shift();

                        PCCViewer.Signatures.add(value);
                    }
                });
                /* jshint +W083 */
            }

            // execute the non-blocking queue
            loadQueue.run(function(){
                // this code will execute if the queue is done or is stopped
                if (signatures.length) {
                    saveSignaturesSync(signatures);
                }
            });
        };

        function getSignatureStorageTemplate() {
            return { values: [] };
        }

        function saveSignaturesSync(signatureArray) {
            // get the current stores signatures
            var signatures = PCCViewer.Signatures.toArray();

            // overwrite the saved signatures collection with the current and appended signatures
            setStoredSignatures(signatures.concat(signatureArray));
        }


        var getStoredSignatures = function () {
            var signatures = localStorage.getItem(signatureStorageKey);

            if (typeof signatures === 'undefined' || signatures === null) {
                // create empty signatures object
                signatures = getSignatureStorageTemplate();
            } else {
                // return current signatures object
                signatures = JSON.parse(signatures);
            }

            return signatures.values;
        };

        var setStoredSignatures = function (signaturesArray) {
            if (!hasLocalStorage) { return; }

            var sigTemplate = getSignatureStorageTemplate();

            // filter out signatures the user did not want to save
            sigTemplate.values = _.filter(signaturesArray, function(el){
                return el.localSave;
            });

            window.localStorage.setItem(signatureStorageKey, JSON.stringify(sigTemplate));
        };

        var clearAllStoredSignatures = function () {
            if (!hasLocalStorage) { return; }

            window.localStorage.removeItem(signatureStorageKey);
        };

        // Initialize the local storage manager
        PCCViewer.Signatures.on('ItemAdded', signatureAdded);
        PCCViewer.Signatures.on('ItemRemoved', signatureRemoved);

        // make sure this module is disposed if the user navigates away from the page
        $(window).on('beforeunload', function(){
            destroy();
        });

        if (hasLocalStorage) {
            loadStoredSignatures();
        }

        return {
            getStored: getStoredSignatures,
            setStored: setStoredSignatures,
            clearAll: clearAllStoredSignatures
        };
    })();

    function parallelSync(funcs, workers, done) {
        if (typeof workers === 'function') {
            done = workers;
            workers = 1;
        }
        var counter = funcs.length;
        var idx = 0;
        var queue = [].concat(funcs);
        var results = [];
        var errCount = 0;

        var next = function() {
            queue.shift()(nextGenerator(idx++));
        };

        var nextGenerator = function(idx) {
            return function(err) {
                if (err) {
                    errCount++;
                }

                results[idx] = [].slice.call(arguments);

                if (--counter === 0) {
                    done(errCount ? true : undefined, results);
                } else if (queue.length) {
                    next();
                }
            };
        };

        while (workers-- && queue.length) {
            next();
        }
    }

    // Expose the Viewer through a jQuery plugin
    $.fn.pccViewer = function (options) {
        if (typeof options === 'undefined') {
            // If we are not given an options argument, return any existing viewer object associated with the
            // selected element.
            return this.data(DATAKEY);
        }
        else {

            // set the language data
            PCCViewer.Language.initializeData(options.language);

            // Create a new viewer
            return new Viewer(this, options);
        }
    };
})(jQuery);

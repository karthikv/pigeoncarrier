var pageMod = require( "page-mod" ); // attach content script to page
var data = require( "self" ).data; // retreive files from /data

pageMod.PageMod( {
    include: [ "http://twitter.com/*", "https://twitter.com/*" ],
    contentScriptWhen: 'ready',
    contentScriptFile: [ 
        data.url( "jquery.min.js" ), // load jQuery
        data.url( "fancybox/jquery.fancybox-1.3.4.pack.js" ), // load fancybox
        data.url( "scribd/view.js" ), // load scribd javascript api
        data.url( "content-script.js" ) // load content-script
    ],
    onAttach: function onAttach ( worker ) {
        worker.postMessage( data.url( '' ) ); // pass base url to content script
    }
} );

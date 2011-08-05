var pageMod = require( 'page-mod' ), // attach content script to page
    data = require( 'self' ).data, // retreive files from /data
    oauth;

pageMod.PageMod( {
    include: [ 'http://twitter.com/*', 'https://twitter.com/*' ],
    contentScriptWhen: 'ready',
    contentScriptFile: [ 
        data.url( 'jquery.min.js' ), // load jQuery
        data.url( 'fancybox/jquery.fancybox-1.3.4.pack.js' ), // load fancybox
        data.url( 'scribd/view.js' ), // load scribd javascript api
        data.url( 'oauth/oauth-simple.js' ), // oauth helper
        data.url( 'content-script.js' ) // load content-script
    ],
    onAttach: function onAttach( worker ) {
        // pass base url to content script
        worker.port.emit( 'resourceURLTransfer', data.url( '' ) );

        // start OAuth dance
        worker.port.on( 'startOAuth', function() {
            console.log( 'Beginning OAuth' );

            oauth = oauth || require( 'oauth' ).oauth(
                'https://api.dropbox.com/0/oauth/request_token',
                'https://www.dropbox.com/0/oauth/authorize',
                'https://api.dropbox.com/0/oauth/access_token',
                'c55r4vo6vfmxx08',
                'qa5k89zc3vxcusx'
            );

            oauth.authorize( function( token, secret ) {
                console.log( 'OAuth successful: ' + token + ' ' + secret );
                worker.port.emit( 'endOAuth', token, secret );
            } );
        } );
    }
} );

// self-invoking anonymous function to prevent pollution of the global namespace
(function() {
    const pageMod = require( 'page-mod' ),
        data = require( 'self' ).data,
        request = require( 'request' ),
        xhr = require( 'xhr' ),
        {Cc, Ci} = require( 'chrome' );
    
    var oauth;

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

            // send an XHR request to the given url via a specified HTTP method
            worker.port.on( 'sendRequest', function( url, method, unique ) {
                console.log( 'Request: ', url );
                var req = request.Request( {
                    url: url,
                    onComplete: function( response ) {
                        console.log( 'Response: ', response.status );
                        worker.port.emit( 'receiveResponse-' + unique,
                            response.status, response.text );
                    }
                } );

                if( method == 'GET' )
                    req.get();
                else
                    req.post();
            } );

            // transfer a file via AJAX using multipart form data
            worker.port.on( 'sendFile', function( url, name, size, type, binary ) {
                console.log( 'Request: ', url );
                // instantiated through Chrome Authority in order to gain
                // access to the upload progress event (see below), which is not
                // supported in the add-on SDK's XHR library
                var req = Cc[ '@mozilla.org/xmlextras/xmlhttprequest;1' ]
                            .createInstance( Ci.nsIXMLHttpRequest );
                var boundary = 'boundary';

                var body = "--" + boundary + "\r\n";
                body += 'Content-Disposition: form-data; name="file"; filename="' + name + "\"\r\n";
                body += "Content-Type: " + type + "\r\n\r\n";
                body += binary + "\r\n";
                body += "--" + boundary + "--";
      
                req.open( 'POST', url, true );
                req.setRequestHeader( 'Content-Length', size );
                req.setRequestHeader( 'Content-Type', 'multipart/form-data; boundary=' + boundary );

                req.onreadystatechange = function() {
                    if( req.readyState == 4 ) {
                        console.log( 'Response: ', req.status );
                        worker.port.emit( 'receiveFile-' + name, req.status, req.responseText );
                        worker.port.emit( 'uploadProgress', name, 1 );
                    }
                };

                req.upload.onprogress = function( event ) {
                    // event.position is the number of bytes uploaded;
                    // event.totalSize is the total number of bytes to upload
                    worker.port.emit( 'uploadProgress', name, event.position / event.totalSize );
                };

                req.sendAsBinary( body );
            } );
        }
    } );
})();


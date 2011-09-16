// self-invoking anonymous function to prevent pollution of the global namespace
(function() {
    const data = require( 'self' ).data,
        request = require( 'request' ),
        tabs = require( 'tabs' );

    exports.oauth = function( requestURL, authorizeURL, accessURL, key, secret ) {
        // Step 1: Obtain request token
        function onBeginOAuth( callback ) {
            console.log( 'onBeginOAuth fired' );
            var requestToken, requestSecret;

            request.Request( {
                url: require( 'oauth-simple' ).oauth.sign( {
                    path: requestURL,
                    parameters: { },
                    signatures: {
                      consumer_key: key,
                      shared_secret: secret
                    }
                } ).signed_url,

                onComplete: function( response ) {
                    var hash = parseResponse( response.text );
                    requestToken = hash.oauth_token;
                    requestSecret = hash.oauth_token_secret;

                    if( requestToken && requestSecret )
                        onObtainRequestToken( requestToken, requestSecret,
                            callback );
                    else
                        console.log( 'OAuth failed; incorrect request token/secret!' );
                }
            } ).get();
        }

        // Step 2: Authorize request token
        function onObtainRequestToken( requestToken, requestSecret, callback ) {
            console.log( 'onObtainRequestToken fired' );
            var callbackURL = 'http://pigeoncarrier.com/oauth.html';

            tabs.open( {
                url: authorizeURL + '?oauth_token=' + requestToken
                    + '&oauth_callback=' + encodeURIComponent( callbackURL ),

                onOpen: function( authorizeTab ) {
                    authorizeTab.on( 'ready', function() {
                        if( authorizeTab.url.indexOf( callbackURL ) === 0 )
                            this.close( function() {
                                onAuthorizeRequestToken( requestToken,
                                    requestSecret, callback );
                            } );
                    } );
                }
            } );
        }

        // Step 3: Get Access Token
        function onAuthorizeRequestToken( requestToken, requestSecret, callback ) {
            console.log( 'onObtainRequestToken fired' );
            var accessToken, accessSecret;

            request.Request( {
                url: require( 'oauth-simple' ).oauth.sign( {
                    path : accessURL,
                    parameters: {
                        oauth_token: requestToken
                    },
                    signatures: {
                        consumer_key: key,
                        shared_secret: secret,
                        oauth_secret: requestSecret
                    }
                } ).signed_url,

                onComplete: function( response ) {
                    var hash = parseResponse( response.text );
                    accessToken = hash.oauth_token;
                    accessSecret = hash.oauth_token_secret;

                    if( accessToken && accessSecret )
                        callback( accessToken, accessSecret );
                    else
                        console.log( 'OAuth failed; incorrect access token/secret!' );
                }
            } ).get();
        }

        // helper function to parse a query string response
        function parseResponse( response ) {
            var hash = { };
            var data = response.split( '&' );

            for( var i = 0; i < data.length; i++ )
            {
                var pair = data[i].split( '=' );
                hash[ pair[0] ] = pair[1];
            }

            return hash;
        }

        // only the authorize function should be public
        return {
            authorize: function( callback ) {
                // Begin OAuth dance!
                // note the closure for encapsulation
                onBeginOAuth( callback );
            }
        };
    };
})();


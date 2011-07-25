// self-invoking anonymous function to prevent pollution of the global namespace
(function() {

    var development = true; // uncompressed file is used in development
    log( 'Content script active!' );

    function log() {
        var args = Array.prototype.slice.call( arguments );

        if( console && development ) {
            if( args.length == 1 )
                // no point in logging the array; just log the one and only
                // argument
                console.log( args[0] );
            else
                console.log( args );
        }
    }

    function assert( condition ) {
        if( console && development )
            console.assert( condition );
    }

    // used to initialize oauth and access config values later
    var oauth_config = {
        'request_url': 'https://api.dropbox.com/0/oauth/request_token',
        'authorize_url': 'https://www.dropbox.com/0/oauth/authorize',
        'access_url': 'https://api.dropbox.com/0/oauth/access_token',
        'consumer_key': 'c55r4vo6vfmxx08',
        'consumer_secret': 'qa5k89zc3vxcusx'
    };

    var oauth = ChromeExOAuth.initBackgroundPage( oauth_config );
    var errorSendResponse;

    chrome.extension.onRequest.addListener(
        function( request, sender, sendResponse ) {
            log( 'Received request of type ' + request.type + '.' );
            if( request.type === 'open' )
                chrome.tabs.create( { url: request.url }, function() {
                    sendResponse( { success: true } );
                } );
            else if( request.type == 'oauth' )
                oauth.authorize( function() {
                    sendResponse( { success: true } );
                } );
            else if( request.type == 'signed_request' )
                sendSignedRequest( request, sendResponse );
            else if( request.type == 'signed_request_file' )
            {
                var bytes = new Uint8Array( request.binary.length );
                for( var i = 0; i < request.binary.length; i++ )
                    bytes[i] = request.binary.charCodeAt( i ) & 0xff;

                var builder = new WebKitBlobBuilder();
                builder.append( bytes.buffer );

                // data to write to a file
                var blob = builder.getBlob( request.file.type );

                // used by errorHandler() in case of an error
                errorSendResponse = sendResponse;

                // handler for a filesystem request; used to write a file that will
                // be transferred via POST to the Dropbox API
                function createFile( fs ) {
                    // delete any files with the same name already in the system
                    fs.root.getFile( request.file.name, { create: false },
                        function( fileEntry ) {
                            fileEntry.remove( afterDelete, afterDelete );
                        }, afterDelete );

                    // handler for the above deletion
                    function afterDelete() {
                        // write a new file
                        fs.root.getFile( request.file.name,
                            { create: true, exclusive: true }, function( fileEntry ) {
                            fileEntry.createWriter( function( fileWriter ) {

                                fileWriter.onwriteend = function( event ) {
                                    // file has been written successfully
                                    fileEntry.file( proceed, errorHandler );
                                };

                                fileWriter.onerror = function( event ) {
                                    // writing failed
                                    errorHandler( 'File writing failed' );
                                };

                                fileWriter.write( blob );
                            }, errorHandler );
                        }, errorHandler );
                    }
                }

                // request filesystem with the correct storage type and space
                window.webkitRequestFileSystem( window.TEMPORARY, blob.size,
                    createFile, errorHandler );

                // handler for when a file is created
                function proceed( file ) {
                    // use a FormData object to transfer the file via XHR
                    var formData = new FormData();
                    formData.append( 'file', file );

                    // FormData must be sent in the body; xhr.send( [FormData
                    // object] )
                    request.data.body = formData;
                    log( 'Using file: ', file, formData );

                    var port = chrome.tabs.connect( sender.tab.id,
                        { name: 'uploadProgress' } );
                    sendSignedRequest( request, sendResponse, function( event ) {
                        // event.position is the number of bytes uploaded;
                        // event.totalSize is the total number of bytes to upload
                        port.postMessage( {
                            name: file.name,
                            progress: event.position / event.totalSize
                        } ); 
                    } );
                }
            }
            else if( request.type == 'has_oauth_token?' )
                sendResponse( { answer: oauth.hasToken() } );
            else
                sendResponse( { } );
        }
    );

    function errorHandler( error ) {
        if( error.code ) {
            switch( error.code ) {
                case FileError.QUOTA_EXCEEDED_ERR:
                    log( 'ERROR: Quote exceeded' );
                    break;

                case FileError.NOT_FOUND_ERR:
                    log( 'ERROR: Not found' );
                    break;

                case FileError.SECURITY_ERR:
                    log( 'ERROR: Security' );
                    break;

                case FileError.INVALID_MODIFICATION_ERR:
                    log( 'ERROR: Invalid modification' );
                    break;

                case FileError.INVALID_STATE_ERR:
                    log( 'ERROR: Invalid state' );
                    break;

                default:
                    log( 'ERROR: Unknown' );
                    break;
            };
        }
        else
            log( 'ERROR: ' + error );

        errorSendResponse( { error: true } );
    }

    function sendSignedRequest( request, sendResponse, progress ) {
        oauth.sendSignedRequest( request.url, function( xhr ) {
            sendResponse( xhr );
        }, request.data, progress );
    }

})();


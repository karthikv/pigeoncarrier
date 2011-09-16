// self-invoking anonymous function to prevent pollution of the global namespace
(function( $, undefined ) {

/****** LOGGING ***************************************************************/

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

/****** RESOURCE URL **********************************************************/

    var resourceURL; // resource url string

    self.port.on( 'resourceURLTransfer', function( url ) {
        log( 'Resource URL obtained: ' + url );
        resourceURL = url;
    } );
    
    var 

/****** ATTACHMENT ADDING VARIABLES *******************************************/

        // jQuery element with information about authorization with Dropbox
        $authorizeInfo,

        // jQuery element of the inserted Add Attachment button
        $addAttachment,

        // jQuery element with information about adding attachments
        $attachmentOptions,

        // jQuery element of #doc div used in Twitter AJAX requests
        $doc,

        // container that holds the tweet textarea
        $tweetBox,

        // tweet textarea
        $tweetTextarea,

        // class of the #doc div
        docClass = false,

        // closure function to add a file to the list of possible attachments
        appendFileToAttachmentList,

        // closure function to update progress bar for file upload
        updateProgress,

        // base URL for pigeon carrier attachments
        baseURL = 'http://pigeoncarrier.com/carry?attachments=',

        // matches pigeon carrier attachment URLs
        rCarryURL = /(http:\/\/pigeoncarrier\.com\/carry\/?\?attachments=)[^ ]+/,

        // matches strings that end without whitespace
        rEndsWithoutWhitespace = /\S$/,

        // LocalStorage helper object
        LocalStorage = {
            get: function( key ) {
                return localStorage[ key ];
            },

            has: function( key ) {
                return !!this.get( key );
            },

            set: function( key, value ) {
                localStorage[ key ] = value;
            },

            remove: function( key ) {
                delete localStorage[ key ];
            }
        },
        
        // Dropbox helper object
        Dropbox = {
            // oauth signatures for making signed requests
            signatures: {
                consumer_key: 'c55r4vo6vfmxx08',
                shared_secret: 'qa5k89zc3vxcusx',
                oauth_token: LocalStorage.get( 'token' ),
                oauth_secret: LocalStorage.get( 'secret' )
            },

            request: function( url, method, parameters, callback, unique ) {
                var data = OAuthSimple().sign( {
                    action: method,
                    path: url,
                    parameters: parameters,
                    signatures: this.signatures
                } );

                // cross-site XHR requests must be done in the add-on script
                // add some unique identifier to allow for concurrent requests
                self.port.emit( 'sendRequest', data.signed_url, method, unique );
                self.port.once( 'receiveResponse-' + unique,
                    function( status, response ) {
                        Dropbox.statusCallback( status, response, callback );
                    } );
            },

            metadata: function( path, callback ) {
                var parameters = {};
                if( LocalStorage.has( path + '-hash' ) )
                    parameters = { hash: LocalStorage.get( path + '-hash' ) };

                this.request( 'https://api.dropbox.com/0/metadata/dropbox/' + path,
                    'GET', parameters, function( status, response ) {
                        switch( status ) {
                            case 200:
                                log( 'Dropbox.metadata: 200 OK' );

                                // no hash included if this is a regular file
                                if( response.hash )
                                {
                                    LocalStorage.set( path + '-hash', response.hash );
                                    LocalStorage.set( path + '-data', 
                                        JSON.stringify( response ) );
                                }

                                callback( 200, response );
                                break;

                            case 304:
                                log( 'Dropbox.metadata: 304 Not Modified' );
                                callback( 200, JSON.parse( LocalStorage.get(
                                    path + '-data' ) ) );
                                break;

                            default:
                                callback( status, response );
                                break;
                        }
                    }, 'metadata-' + path );
            },

            getAccountInfo: function( callback ) {
                this.request( 'https://api.dropbox.com/0/account/info',
                    'GET', { }, callback, 'account-info' );
            },

            createFolder: function( path, callback ) {
                this.request( 'https://api.dropbox.com/0/fileops/create_folder',
                    'POST', { path: path, root: 'dropbox' }, callback,
                    'create-folder' );
            },

            uploadFile: function( binary, file, callback ) {
                var name = file.name,
                    data = OAuthSimple().sign( {
                        action: 'POST',
                        path: 'https://api-content.dropbox.com/0/files/dropbox/Public/'
                            + 'pigeon-carrier/',
                        parameters: {
                            file: name
                        },
                        signatures: this.signatures
                    } );

                // cross-site XHR requests must be done in the add-on script
                self.port.emit( 'sendFile', data.signed_url, name, file.size,
                    file.type, binary );
                self.port.once( 'receiveFile-' + name,
                    function( status, response ) {
                        Dropbox.statusCallback( status, response, callback );
                    } );
            },

            statusCallback: function( status, response, callback ) {
                if( status == 200 )
                    response = JSON.parse( response );
                callback( status, response );
            },

            updateAuthentication: function( token, secret ) {
                // no need to re-authenticate if local storage is used
                LocalStorage.set( 'token', token );
                LocalStorage.set( 'secret', secret );

                this.signatures.oauth_token = token;
                this.signatures.oauth_secret = secret;
            }
        },

/****** ATTACHMENT VIEWING VARIABLES ******************************************/

        // api key for scribd
        scribdID = 'pub-45792848697030382619',

        // accepted filetypes for html view via scribd instead of download
        scribdFiletypes = {
            xls: true, xlsx: true,
            ppt: true, pps: true, pptx: true,
            doc: true, docx: true,
            odt: true, odp: true, ods: true,
            sxw: true, sxi: true, sxc: true,
            txt: true, rtf: true,
            ps: true, pdf: true
        },
        
        // keystring for base64 encode/decode
        keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',

        // accepted filetypes for html view directly instead of download
        imageFiletypes = { 'jpg': true, 'jpeg': true, 'png': true, 'gif': true },

/****** GENERAL VARIABLES *****************************************************/

        // whether the new message modal dialog is visible
        dialogVisible = false;

        // whether or not the tweet button was found
        foundButton = false;

    // jQuery won't normally include this in the event object, but it
    // is necessary for drag and drop
    $.event.props.push( 'dataTransfer' );

    /**
     * Resets all global variables and the DOM in preparation for running the
     * extension. This method is present because Twitter loads its pages via
     * AJAX, meaning this script is not run anew, thereby necessitating a reset
     * each time the page changes.
     */ 
    function reset() {

/****** ATTACHMENT ADDING RESET ***********************************************/

        $( '#authorize-info' ).remove();
        $authorizeInfo = undefined;

        $( '#add-attachment' ).remove();
        $addAttachment = undefined;

        $( '#attachment-options' ).remove();
        $attachmentOptions = undefined;

        $tweetBox = undefined;
        $tweetTextarea = undefined;
        appendFileToAttachmentList = undefined;

        updateProgress = undefined;

/****** GENERAL RESET *********************************************************/

        foundButton = false;
    }

    // when the document is ready...
    $(function() {

/****** GENERAL PERIODIC FUNCTIONS ********************************************/

        /**
         * Loads CSS files via link elements in the head tag.
         */
        (function loadCSSFiles() {
            if( ! resourceURL )
                setTimeout( loadCSSFiles, 500 );
            else {
                loadCSS( resourceURL + 'content-style.css' );
                loadCSS( resourceURL + 'fancybox/jquery.fancybox-1.3.4.css' );
            }
        })();

        /**
         * Triggers and resets the extension at the right times, as prescribed
         * by AJAX loading of new pages and when DOM elements are successfully
         * found.
         */
        (function triggerExtension() {
            if( !$doc ) {
                $doc = $( '#doc' );

                if( $doc.length <= 0 ) // no element found
                {
                    // don't continue until #doc is found
                    $doc = false;
                    setTimeout( triggerExtension, 500 );
                    return;
                }
            }

            // Twitter loads pages via ajax, changing the class name of the
            // #doc div; by monitoring this element, we can still dynamically
            // insert the add attachment button on new pages
            if( $doc.attr( 'class' ) != docClass )
            {
                reset();
                docClass = $doc.attr( 'class' );
            }
            // tweet dialog was shown or hidden; reset and re-awaken
            else if( dialogVisible ^ $( '#tweet_dialog' ).is( ':visible' ) )
            {
                reset();
                dialogVisible = !dialogVisible;
            }
            else if( !foundButton && $( '.tweet-button' ).length > 0 )
            {
                // cache tweet box and textarea; pick the right one based on if
                // the tweet dialog is visible
                if( dialogVisible ) {
                    var $tweetDialog = $( '#tweet_dialog' );
                    $tweetBox = $( '.tweet-box', $tweetDialog );
                    $tweetTextarea = $( '.twitter-anywhere-tweet-box-editor', 
                        $tweetDialog );
                }
                // simple selectors if the tweet dialog isn't visible
                else {
                    $tweetBox = $( '.tweet-box' );
                    $tweetTextarea = $( '.twitter-anywhere-tweet-box-editor' );
                }

                // awaken the extension!
                awaken();
                foundButton = true;
            }

            setTimeout( triggerExtension, 500 );
        })();

/****** ATTACHMENT VIEWING PERIODIC FUNCTIONS *********************************/

        (function processAttachments() {
            var a = 'a[data-expanded-url]';
            $( '.tweet-text ' + a + ', .linked-text ' + a ).each( function() {
                var $this = $(this);
                var url = $this.data( 'expanded-url' );

                if( !rCarryURL.test( url ) )
                    // invalid URL
                    return;

                // get the json
                var json = url.substr( url.indexOf( '=' ) + 1 );
                json = base64_decode( decodeURIComponent( json ) );

                var data;
                try {
                    data = JSON.parse( json );
                } catch( e ) {
                    log( 'Invalid json: ' + json );
                    return;
                }

                log( 'Found URL; processing.' );

                // element won't be selected again
                $this.removeAttr( 'data-expanded-url' );

                var $displayList = $( '<ul></ul>', {
                    'class': 'display-list'
                } ).css( 'margin-top', '10px' );

                $.each( data.files, function( i, file ) {
                    var url = 'http://dl.dropbox.com/u/' + data.uid + '/pigeon-carrier/' + file.name;
                    var $li = $( '<li><img src="' + resourceURL
                        + 'icons/16x16/' + file.icon + '.gif' + '"'
                        + ' alt="File Attachment"></img>' + file.name + '<span'
                        + ' class="actions"><a href="' + url + '">'
                        + 'Download</a></span></li>' )
                        .appendTo( $displayList );

                    var ext = file.name.substr( file.name.lastIndexOf( '.' ) + 1 );
                    ext = ext.toLowerCase();

                    var $link;
                    if( scribdFiletypes[ ext ] || imageFiletypes[ ext ] )
                    {
                        // add a bullet point between view and download
                        var $actions = $li.children( '.actions' );
                        $actions.prepend( ' &#149; ' );

                        // create the view link
                        $link = $( '<a></a>', {
                            href: url,
                            text: 'View'
                        } ).prependTo( $actions );
                    }

                    // add a preview to the file if possible
                    if( scribdFiletypes[ ext ] )
                        // scribd preview
                        // closure to access the correct URL
                        (function( url ) {
                            $link.fancybox( {
                                transitionIn: 'elastic',
                                transitionOut: 'elastic',
                                speedIn: 600,
                                speedOut: 200,
                                overlayShow: true,
                                autoDimensions: false,
                                width: 510,
                                height: 660,
                                content: '<div id="scribd">Loading...</div>',
                                onComplete: function() {
                                    var scribdDoc = scribd.Document.getDocFromUrl( url, scribdID );
                                    scribdDoc.addParam( 'public', true );

                                    // write the scribd HTML into the fancybox
                                    // content div
                                    scribdDoc.write( 'scribd' );
                                    setTimeout( $.fancybox.resize, 5000 );
                                }
                            } );
                        })( url );
                    else if( imageFiletypes[ ext ] )
                        // fancybox preview
                        $link.fancybox( {
                            transitionIn: 'elastic',
                            transitionOut: 'elastic',
                            speedIn: 600,
                            speedOut: 200,
                            overlayShow: true
                        } );
                } );

                $displayList.hide()
                    .appendTo( $this.parent() );

                $this.text( 'Attachments' )
                    .addClass( 'attachments-link' )
                    // if the default action of the click event isn't prevented,
                    // this acts as a simple safety
                    .attr( 'href', '#' )
                    .click( function( event ) {
                        $displayList.slideToggle();
                        event.preventDefault();
                    } );
            } );

            // repeat since tweets are dynamically loaded
            setTimeout( processAttachments, 500 );
        })();

    });

/****** ATTACHMENT ADDING FUNCTIONS *******************************************/

    function awaken() {
        $authorizeInfo = $( '<div></div>', {
            id: 'authorize-info'
        } ).append( '<p>To attach a file directly from your file system, it needs to first be uploaded to your <a href="http://dropbox.com">Dropbox account</a>. Pigeon Carrier will take care of most of the details for you; simply authorize our application to access your Dropbox through the link below. Note that attachments may be found in your public folder under the pigeon-carrier directory.</p>' )
            .append( '<p>If you have already uploaded the file you would like to attach to the pigeon-carrier sub-folder, you may simply select it from the list below after authorization.</p>' )
            .append( '<p>In terms of security, we will only use your Dropbox account for managing attachments. This constitutes the upload process and providing Dropbox links in your Tweets for other users to download attachments. Please be aware that although Pigeon Carrier tries to streamline your <a href="http://twitter.com">Twitter</a> experience, it is not directly affiliated with Twitter Inc. in any way.</p>' )
            .append( '<p><a href="#" id="authorize">Authorize with Dropbox</a></p>' )
            .hide()
            .appendTo( $tweetBox );

        $addAttachment = $( '<a></a>', {
            id: 'add-attachment',
            'class': 'tweet-button button iframe',
            text: 'Add Attachment',
            
            href: '#', 
            click: function(event) {
                event.preventDefault();

                var $this = $(this);
                if( $this.hasClass( 'disabled' ) )
                    return;

                $authorizeInfo.slideDown();
                $this.addClass( 'disabled' );
            }
        } ).insertBefore( $( '.tweet-button', $tweetBox ) );

        $( '#authorize' ).click( function(event) {
            authorize();
            event.preventDefault();
        } );

        if( LocalStorage.has( 'token' ) && LocalStorage.has( 'secret' ) )
            onAuthorized(); // already authenticated
    }

    function authorize() {
        log( 'Authorizing...' );
        self.port.emit( 'startOAuth' );

        self.port.on( 'endOAuth', function( token, secret ) {
            Dropbox.updateAuthentication( token, secret );
            onAuthorized();
        } );
    }

    function onAuthorized() {
        log( 'Authorized!' );
        $( '#authorize' ).parent().html( 'You\'re authorized!' );

        // if authorization info is visible, the attachment options should be
        // shown immediately
        if( $authorizeInfo.is( ':visible' ) )
        {
            $authorizeInfo.slideUp();
            $addAttachment.unbind( 'click' );
            createAttachmentOptions();
        }
        // otherwise, bind it to the add attachment button's click event
        else
        {
            // old click event is obsolete
            $addAttachment.unbind( 'click' );
            $addAttachment.click( function() {
                var $this = $(this);

                $this.addClass( 'disabled' );
                $this.unbind( 'click' ); // only activate once

                createAttachmentOptions();
            } );
        }
    }

    function createAttachmentOptions() {
        $attachmentOptions = $( '<div></div>', {
            id: 'attachment-options'
        } ).hide()
            .appendTo( $tweetBox );

        // users may click this button to try again in case an error occurs
        $addAttachment.click( function( event ) {
            event.preventDefault();

            var $this = $(this);
            if( $this.hasClass( 'disabled' ) )
                return;

            $this.addClass( 'disabled' );
            $attachmentOptions.slideUp( 400, function() {
                $attachmentOptions.html( '' ); // clear html
                getDropboxInfo();
            } );
        } );

        getDropboxInfo();
    }

    function getDropboxInfo() {
        // returned metadata from the Dropbox API for the pigeon-carrier folder
        var dirMetadata = false,
             message,
             creatingFolder = false;

        Dropbox.metadata( 'Public/pigeon-carrier', function( status, response ) {
            switch( status ) {
                case 200:
                    // there is some file, but it has been deleted
                    if( response.is_deleted )
                    {
                        // nothing; fall through to the next case
                    }
                    // there is a file called carrier-pigeon
                    else if( ! response.is_dir )
                    {
                        message = 'A file called pigeon-carrier is already present in'
                            + ' your Dropbox public folder. Please rename or remove'
                            + ' this file so Pigeon Carrier can create an equivalently'
                            + '-named directory to store your attachments.';
                        log( 'ERROR: File called pigeon-carrier is present!' );
                        break;
                    }
                    else
                    {
                        if( response.contents.length > 0 )
                            message = 'It looks like you have some'
                                + ' previously-used attachments in Dropbox. You'
                                + ' can either choose from these or just upload'
                                + ' new ones below!';
                        else
                            message = 'Upload a file below to get started!';

                        dirMetadata = response;
                        log( dirMetadata );
                        break;
                    }

                    // fall through to the next case

                // directory doesn't exist
                case 404:
                    log( 'No directory found; creating!' );

                    creatingFolder = true;
                    Dropbox.createFolder( 'Public/pigeon-carrier', 
                        function( status, response ) {
                            switch( status ) {
                                case 403:
                                    message = 'The pigeon-carrier directory was unable'
                                        + ' to be created.';
                                    log( 'ERROR: File or folder already exists' );
                                    break;

                                case 404:
                                    message = 'The pigeon-carrier directory was unable'
                                        + ' to be created.';
                                    log( 'ERROR: Specified file path not found' );
                                    break;

                                case 503:
                                    message = 'Sorry, we\'re being rate limited.'
                                        + ' Please try again later.';
                                    log( 'ERROR: Rate limited' );
                                    break;

                                case 507:
                                    message = 'Your Dropbox account is over quota.'
                                        + ' Please remove some files.';
                                    log( 'ERROR: User over quota' );
                                    break;

                                case 200:
                                    message = 'A pigeon-carrier directory for'
                                        + ' attachments was successfully created in your'
                                        + ' Dropbox public folder. Go ahead and upload'
                                        + ' your first attachment below!';
                                    log( 'Successfully created pigeon-carrier'
                                        + ' directory!' );

                                    // Dropbox seems to return a 304 not
                                    // modified even though the directory was
                                    // newly created. Remove the stored hash to
                                    // force Dropbox to present new data.
                                    LocalStorage.remove( 'Public/pigeon-carrier-hash' );

                                    dirMetadata = response;
                                    log( dirMetadata );
                                    break;

                                default:
                                    message = 'The pigeon-carrier directory was unable'
                                        + ' to be created.';
                                    log( 'ERROR: Unknown status ' + status );
                                    break;
                            }

                            showAttachmentOptionsProxy( dirMetadata, message );
                        } );
                    break;

                case 406:
                    message = 'There were too many files in your Dropbox'
                        + ' pigeon-carrier directory under your public folder.'
                        + ' The limit is 10000. Please relocate or remove files'
                        + ' until you are under this limit.';
                    log( 'ERROR: Too many entries to return!' );
                    break;

                case 503:
                    message = 'Sorry, we\'re being rate limited.'
                        + ' Please try again later.';
                    log( 'ERROR: Rate limited' );
                    break;

                default:
                    message = 'Files in your pigeon-carrier directory could not be'
                        + ' listed.';
                    log( 'ERROR: Unknown status ' + status );
                    break;
            }

            // if a folder is being created, showAttachmentOptions() will be called 
            // in the Dropbox.createFolder() callback above
            if( ! creatingFolder )
                showAttachmentOptionsProxy( dirMetadata, message );
        } );
    }

    function showAttachmentOptionsProxy( dirMetadata, message )
    {
        if( ! dirMetadata )
            showAttachmentOptions( dirMetadata, message, {} );
        else {
            Dropbox.getAccountInfo( function( status, response ) {
                var accountInfo = {};

                switch( status ) {
                    case 200:
                        accountInfo = response; 
                        break;

                    case 503:
                        dirMetadata = false;
                        message = 'Sorry, we\'re being rate limited.'
                            + ' Please try again later.';
                        log( 'ERROR: Rate limited' );
                        break;

                    default:
                        dirMetadata = false;
                        message = 'Your Dropbox account information could not'
                            + ' be retrieved.';
                        log( 'ERROR: Unknown status ' + status );
                        break;
                }

                showAttachmentOptions( dirMetadata, message, accountInfo );
            } );
        }
    }

    function showAttachmentOptions( dirMetadata, message, accountInfo )
    {
        // an error occurred
        if( ! dirMetadata )
        {
            $( '<p></p>', {
                id: 'pigeon-message',
                'class': 'pigeon-error',
                text: message + ' Click the \'Add Attachment\' button to try'
                    + ' again.'
            } ).appendTo( $attachmentOptions );

            $addAttachment.removeClass( 'disabled' );
        }
        // success
        else
        {
            $( '<p></p>', {
                id: 'pigeon-message',
                'class': 'pigeon-success',
                text: message
            } ).appendTo( $attachmentOptions );

            var $fileWrapper = $( '<div></div>', {
                id: 'file-wrapper'
            } );

            function changeHandler( event )
            {
                processFiles( this.files );

                $( this ).replaceWith( function() {
                    // create an equivalent input with the same handler
                    return $( '<input type="file" name="attachments[]"'
                        + 'multiple="true"></input>' ).change( changeHandler );
                } );
            }

            $( '<input type="file" name="attachments[]"'
                + ' multiple="true"></input>' )
                .change( changeHandler )
                .bind( 'dragenter dragleave', function( event ) {
                    // only target on this element; ignore bubbling
                    if( event.target == this )
                        // change styles to acknowledge drop
                        $fileWrapper.toggleClass( 'dragging' );
                } )
                .appendTo( $fileWrapper );

            // default action and bubbling be stopped for drop event to fire
            $fileWrapper.bind( 'dragover dragenter', false );

            $fileWrapper.bind( 'drop', function( event ) {
                event.stopPropagation();
                event.preventDefault();

                processFiles( event.dataTransfer.files );
                $fileWrapper.removeClass( 'dragging' );
            } );

            // text and paragraph that contains it
            var fileText = 'Drag/drop your files here or click to choose from a list.'
            var $fileText = $( '<p></p>', {
                text: fileText
            } ).appendTo( $fileWrapper );

            var $fileList = $( '<div></div>', {
                'class': 'file-list'
            } );

            $( "<p>Click on files below to select/unselect them as attachments. Once finished, click the 'Attach' button underneath the textbox above to insert a link into your tweet. Although seemingly normal, this magical link will transport your files to infinity and beyond!</p>" )
                .appendTo( $fileList );

            var $attachmentList = $( '<ul></ul>' )
                .appendTo( $fileList );

            var inList = { };
            appendFileToAttachmentList = function( file, select ) {
                var fileName = file.path.substring( 23 );

                if( inList[ fileName ] )
                {
                    // select this file if necessary
                    if( select )
                    {
                        var $file = $( 'a[data-name="' + fileName + '"]',
                            $attachmentList );

                        if( !$file.hasClass( 'selected' ) ) {
                            $file.addClass( 'selected' );
                            // update number of files selected
                            updateSelected( true );
                        }
                    }

                    // this file is already in the list
                    return;
                }

                var attrs = 'href="#" data-name="' + fileName + '" data-icon="'
                    + file.icon + '"';

                if( select )
                {
                    // should immediately select this element
                    attrs += ' class="selected"';
                    updateSelected( true );
                }

                $attachmentList.append( $( '<li><a ' + attrs + '>'
                    + '<img src="' + resourceURL
                    + 'icons/16x16/' + file.icon + '.gif'
                    + '" alt="File Attachment"></img>'
                    // only file name; strip /Public/pigeon-carrier/
                    + fileName + '</a></li>' ) );

                // keep track of which files are in the list
                inList[ fileName ] = true;
            };

            var numSelected = 0;
            function updateSelected( fileAdded ) {
                if( fileAdded )
                    numSelected++;
                else
                    numSelected--;

                // enable/disable the attach button as necessary
                if( numSelected > 0 )
                    $addAttachment.removeClass( 'disabled' );
                else
                    $addAttachment.addClass( 'disabled' );
            }

            $addAttachment.unbind( 'click' );
            $addAttachment.click( function( event ) {
                event.preventDefault();

                if( $(this).hasClass( 'disabled' ) )
                    return;

                // extract data from selected elements
                var data = { uid: accountInfo.uid, files: [ ] }
                $( '.selected', $attachmentList ).each( function( i ) {
                    var $this = $(this);
                    data.files.push( {
                        name: $this.data( 'name' ),
                        icon: $this.data( 'icon' )
                    } );
                } );

                var val = $tweetTextarea.val();

                // encode URL data in base64
                var encodedData = encodeURIComponent( base64_encode(
                    JSON.stringify( data ) ) );

                // if URL already exists, replace it
                if( rCarryURL.test( val ) ) {
                    var newURL = baseURL + encodedData;
                    val = val.replace( rCarryURL, newURL );
                    $tweetTextarea.val( val );

                    var linkIndex = val.indexOf( newURL );
                    $tweetTextarea[0].setSelectionRange( linkIndex, linkIndex
                        + newURL.length );
                }
                // otherwise, add one
                else {
                    // if the tweet doesn't end in whitespace, add some
                    if( val.length != 0 && val[ val.length - 1 ].match( /\S$/ ) )
                        val += ' ';
                        
                    $tweetTextarea.val( val + baseURL + encodedData );
                    $tweetTextarea[0].setSelectionRange( val.length,
                        $tweetTextarea.val().length );
                }
            } );

            var $fileUploadProgress = $( '<ul></ul>', {
                id: 'file-upload-progress'
            } );

            updateProgress = function( name, progress ) {
                // find the progress li that corresponds to this file
                $uploadProgress = $fileUploadProgress.children(
                    '[data-name="' + name + '"]' );

                // negative progress means remove the file
                if( progress < 0 )
                {
                    $uploadProgress.fadeOut( 400, function() {
                        $uploadProgress.remove();
                    } );
                    return;
                }

                // if it doesn't exist, create a new one
                if( $uploadProgress.length <= 0 )
                    $uploadProgress = $( '<li><span class="name">' + name
                        + '</span><div></div><span class="percent">0%</span>'
                        + '</li>' )
                        .attr( 'data-name', name )
                        .appendTo( $fileUploadProgress );

                var percent = Math.round( progress * 100 );

                // update percent that has been uploaded
                $uploadProgress.children( '.percent' )
                    .text( percent + '%' );

                // use width and margin to create an elegant progress bar
                // that expands to the right
                var width = percent * 2; // range [0, 200]px
                $uploadProgress.children( 'div' )
                    .css( {
                        width: width + 'px',
                        marginRight: ( 200 - width ) + 'px'
                    } );

                // check progress for success, as percent is rounded
                if( progress >= 1 )
                {
                    // wrap in a closure to ensure the correct $uploadProgress
                    // is used
                    (function( name ) {
                        // remove this file's progress display in 3 seconds,
                        // since it has uploaded successfully
                        setTimeout( function() {
                            updateProgress( name, -1 );
                        }, 3000 );
                    })( name );
                }
            };

            // may not exist if pigeon-carrier directory was just created
            if( dirMetadata.contents )
            {
                for( var i = 0; i < dirMetadata.contents.length; i++ )
                {
                    var content = dirMetadata.contents[i];

                    if( ! content.is_dir )
                        // don't auto-select these, as they were already present in
                        // the directory
                        appendFileToAttachmentList( content, false );
                }
            }

            $fileList.click( function( event ) {
                var $link;

                // access the anchor tag even if the image is clicked
                if( event.target.nodeName == 'A' )
                    $link = $( event.target );
                else if( event.target.nodeName == 'IMG' )
                    $link = $( event.target ).parent();

                if( $link ) {
                    // clicked on an attachment link; toggle the selected class
                    $link.toggleClass( 'selected' );
                    updateSelected( $link.hasClass( 'selected' ) );
                    event.preventDefault();
                }
            } );

            $fileList.appendTo( $attachmentOptions );
            $fileWrapper.appendTo( $attachmentOptions );
            $fileUploadProgress.appendTo( $attachmentOptions );
        }

        $attachmentOptions.slideDown( 400, function() {
            if( dirMetadata ) // success
                $addAttachment.text( 'Attach' );
        } );
    }

    // update success/error message; showAttachmentOptions() must be called
    // before this function is used
    function updateMessage( type, message ) {
        $( '#pigeon-message' ).slideUp( 400, function() {
            $(this).attr( 'class', 'pigeon-' + type )
                .text( message )
                .slideDown();
        } );
    }

    function processFiles( files ) {
        $.each( files, function( i, file ) {
            // set the progress to 0 so the user knows the file is queued for
            // upload
            updateProgress( file.name, 0 );

            // read each file and upload it
            var reader = new FileReader();

            reader.onloadend = function( event ) {
                // loaded contains the number of octets transferred; total is
                // the total number of octets
                if( event.loaded < event.total ) {
                    // if loaded is less than total, assume an error occurred
                    updateMessage( 'error', file.name + ' could not be read.'
                        + ' Please try again.' );
                    updateProgress( file.name, -1 );
                    return;
                }

                makeUploadRequest( event, file );
            };

            reader.readAsBinaryString( file );
        } );
    }

    // get the upload progress from the add-on script
    self.port.on( 'uploadProgress', function( name, progress ) {
        // updateProgress itself can't be the handler because its value changes
        updateProgress( name, progress );
    } );

    function makeUploadRequest( event, file ) {
        // finished reading the file
        if( event.target.readyState == 2 )
        {
            log( 'Reading done; sending request!' );

            // all set; upload!
            Dropbox.uploadFile( event.target.result, file,
                function( status, response ) {
                    if( status.error ) {
                        updateMessage( 'error', 'The upload was unable to be'
                            + ' completed. Please try again.' );
                        updateProgress( file.name, -1 );
                        return;
                    }

                    var message;

                    switch( status ) {
                        case 200:
                            log( 'Getting metadata ' + file.name );
                            Dropbox.metadata( 'Public/pigeon-carrier/' + file.name,
                                function( status, response ) {
                                    switch( status ) {
                                        case 200:
                                            appendFileToAttachmentList( response,
                                                true );
                                            break;

                                        default:
                                            // no need to throw an error; user
                                            // can simply click on the file to
                                            // choose it for upload
                                            break;
                                    }
                                } );
                            break;

                        case 503:
                            message = 'Sorry, we\'re being rate limited.'
                                + ' Please try again later.';
                            log( 'ERROR: Rate limited' );
                            break;

                        default:
                            message = 'Files in your pigeon-carrier directory could not be'
                                + ' listed.';
                            log( 'ERROR: Unknown status ' + status );
                            break;
                    }

                    if( message )
                        updateMessage( 'error', message );

                    log( 'Upload success!', status, response );
                } );
        }
    }

/****** GENERAL FUNCTIONS *****************************************************/

    /**
     * Loads a custom CSS file dynamically into the browser via
     * a link tag in the head section.
     */
    function loadCSS( url ) {
        log( 'Loading CSS file: ' + url );
        var $head = $( 'head' );

        if( $head.children( 'link[href="' + url + '"]' ).length == 0 )
            $link = $( '<link>', {
                href: url,
                rel: 'stylesheet',
                type: 'text/css',
            } ).appendTo( $head );
    }

    /**
     * Encodes input data into base64 based on a key string.
     * @return the base64-encoded input string
     */
    function base64_encode( input ) {
        input = escape( input );
        var output = '';
        var c1, c2, c3 = '';
        var e1, e2, e3, e4 = '';
        var i = 0;

        do {
            c1 = input.charCodeAt( i++ );
            c2 = input.charCodeAt( i++ );
            c3 = input.charCodeAt( i++ );

            e1 = c1 >> 2;
            e2 = ( ( c1 & 3 ) << 4 ) | ( c2 >> 4 );
            e3 = ( ( c2 & 15 ) << 2 ) | ( c3 >> 6 );
            e4 = c3 & 63;

            if ( isNaN( c2 ) ) {
                e3 = e4 = 64;
            } else if ( isNaN( c3 ) ) {
                e4 = 64;
            }

            output += keyStr.charAt( e1 )
                + keyStr.charAt( e2 )
                + keyStr.charAt( e3 )
                + keyStr.charAt( e4 );

            c1 = c2 = c3 = '';
            e1 = e2 = e3 = e4 = '';
        } while ( i < input.length );

        return output;
    }

    /**
     * Decodes encoded data from base64 based on a key string.
     * @return the raw, unencoded input string
     */
    function base64_decode( input ) {
        var output = '';
        var c1, c2, c3 = '';
        var e1, e2, e3, e4 = '';
        var i = 0;

        var b64 = /[^A-Za-z0-9\+\/\=]/g;
        if ( b64.exec( input ) ) {
            log( 'base64_decode: invalid characters' );
        }
        input = input.replace( b64, '' );

        do {
            e1 = keyStr.indexOf( input.charAt( i++ ) );
            e2 = keyStr.indexOf( input.charAt( i++ ) );
            e3 = keyStr.indexOf( input.charAt( i++ ) );
            e4 = keyStr.indexOf( input.charAt( i++ ) );

            c1 = ( e1 << 2 ) | ( e2 >> 4 );
            c2 = ( ( e2 & 15 ) << 4 ) | ( e3 >> 2 );
            c3 = ( ( e3 & 3 ) << 6 ) | e4;

            output += String.fromCharCode( c1 );

            if ( e3 != 64 ) {
                output += String.fromCharCode( c2 );
            }
            
            if ( e4 != 64 ) {
                output += String.fromCharCode( c3 );
            }

            c1 = c2 = c3 = '';
            e1 = e2 = e3 = e4 = '';

        } while ( i < input.length );

        return unescape( output );
    }

})(jQuery);


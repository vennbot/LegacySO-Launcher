// Add a hook to make all links open a new window.
window.DOMPurify.addHook( 'afterSanitizeAttributes', node => {
  // set all elements owning target to target=_blank.
  if ( 'target' in node ) node.setAttribute( 'target', '_blank' );
  // set non-HTML/MathML links to xlink:show=new.
  if ( ! node.hasAttribute( 'target' ) &&
    ( node.hasAttribute( 'xlink:href' ) || node.hasAttribute( 'href' ) ) ) {
    node.setAttribute( 'xlink:show', 'new' );
  }
} );

// Expose functions to the DOM
let navigateTo;
// eslint-disable-next-line no-unused-vars
let closeOneClickInstall;
// eslint-disable-next-line no-unused-vars
let ociPickFolder;
// eslint-disable-next-line no-unused-vars
let ociConfirm;

( () => {
  const parsedWsUrl = new URL( getPugVar( 'ws-url' ) );
  const baseWsUrl = `${parsedWsUrl.protocol}//${parsedWsUrl.hostname}${parsedWsUrl.port ? ':' + parsedWsUrl.port : ''}`;
  const socket = window.io( baseWsUrl, {
    path: parsedWsUrl.pathname,
    reconnectionAttempts: 8,
    reconnectionDelay: 2000
  } );

  const clickAudio = new window.Howl( { src: 'sounds/click.wav', volume: 0.4 } );
  const modalAudio = new window.Howl( { src: 'sounds/modal.wav', volume: 0.4 } );
  const okAudio    = new window.Howl( { src: 'sounds/ok.wav', volume: 0.4 } );

  const isDarwin  = document.querySelector( 'html' ).className.startsWith( 'darwin' );
  const isWindows = document.querySelector( 'html' ).className.startsWith( 'win32' );
  const isLinux = document.querySelector( 'html' ).className.startsWith( 'linux' );

  let simitoneInterval;
  let simitoneUpdate;
  let prevTheme;
  let totalUnreadProgressItems = 0;

  function run() {
    // Let the main process know the DOM is ready
    sendMessage( 'INIT_DOM' );
    // Start at the homepage
    navigateTo( 'home' );
    // Start the TSO clock
    updateTSOClock();
    setInterval( updateTSOClock, 1000 );
    // Fetch initial blog feed and trending lots (with delay to allow proxy server to start)
    setTimeout(() => {
      fetchWidgetData();
    }, 3000); // Wait 3 seconds for proxy server to be ready
    // Listen for global messages
    socket.on( 'receive global message', data => handleSocketMessage( data ) );
    // Begin the scenarios loop.
    runScenarios();
  }

  function handleSocketMessage( data ) {
    sendMessage( 'SOCKET_MESSAGE', [ data.Message, data.Url ] );
  }

  function sendMessage( id, ...params ) {
    window.shared.send( id, ...params );
  }

  function onMessage( id, callback ) {
    return window.shared.on( id, callback );
  }

  /**
   * Wrapper for addEventListener with auto tabindex and role management
   * for accessibility.
   *
   * @param {string|HTMLElement} s - The CSS selector string or HTMLElement to which the event listener will be added.
   * @param {string} eventType - The type of event to listen for (e.g., 'click', 'keydown').
   * @param {function(Event): void} callback - The callback function to be executed when the event is triggered. Receives the event object as an argument.
   */
  function addEventListener( s, eventType, callback ) {
    const el = s.tagName ? s : document.querySelector( s );
    if ( eventType === 'click' && 'body' !== el.tagName ) {
      el.setAttribute( 'role', 'button' );
      el.setAttribute( 'tabindex', '0' );
      el.addEventListener( 'keydown', e => e.key === 'Enter' || e.key === ' ' ? callback( e ) : null );
    }
    el.addEventListener( eventType, callback );
  }

  /**
   * Wrapper for addEventListener with auto tabindex and role management
   * for accessibility.
   *
   * @param {string} s - The CSS selector string targeting the elements to which the event listener will be added.
   * @param {string} eventType - The type of event to listen for (e.g., 'click', 'keydown').
   * @param {function(Event, HTMLElement): void} callback - The callback function to be executed when the event is triggered.
   *        Receives the event object as the first argument and the current element as the second argument.
   */
  function addEventListenerAll( s, eventType, callback ) {
    document.querySelectorAll( s ).forEach( element => {
      if ( eventType === 'click' ) {
        element.setAttribute( 'role', 'button' );
        element.setAttribute( 'tabindex', '0' );
        element.addEventListener( 'keydown', e => e.key === 'Enter' || e.key === ' ' ? callback( e, element ) : null );
      }
      element.addEventListener( eventType, e => callback( e, element ) );
    } );
  }

  function getCurrentPage() {
    return document.querySelector( '[page-trigger].active' ).getAttribute( 'page-trigger' );
  }

  function updateTSOClock() {
    const currentTime = new Date(),
      utcMinutes = currentTime.getUTCMinutes(),
      utcSeconds = currentTime.getUTCSeconds();
    let timePeriod = 'AM', totalSeconds = 0;
    if ( currentTime.getUTCHours() % 2 === 1 ) {
      totalSeconds = 3600;
      timePeriod = 'PM';
    }
    totalSeconds += utcMinutes * 60 + utcSeconds;
    let hour = Math.floor( totalSeconds / 300 );
    if ( hour > 12 ) {
      hour -= 12;
    }
    if ( hour === 0 ) {
      hour = 12;
    }
    let minute = Math.floor( totalSeconds % 300 / 5 );
    if ( minute < 10 ) {
      minute = '0' + minute;
    }
    const simTimeElement = document.querySelector( '#simtime' );
    if ( simTimeElement ) {
      simTimeElement.textContent = `${hour}:${minute} ${timePeriod}`;
    }
  }

  const simitonePage = document.querySelector( '#simitone-page' );

  function simitoneInstalled() {
    simitonePage.classList.add( 'simitone-installed' );
  }
  function simitoneNotInstalled() {
    simitonePage.classList.remove( 'simitone-installed' );
  }
  function simsInstalled() {
    simitonePage.classList.add( 'ts1cc-installed' );
  }
  function simsNotInstalled() {
    simitonePage.classList.remove( 'ts1cc-installed' );
  }
  function simitoneShouldUpdate() {
    simitonePage.classList.add( 'simitone-should-update' );
    document.querySelector( '#simitone-update-version' ).textContent = simitoneUpdate;
  }
  function simitoneShouldntUpdate() {
    simitonePage.classList.remove( 'simitone-should-update' );
  }

  /**
   * Returns the date as x time ago.
   *
   * @param {Date} date
   */
  function ago( date ) {
    const b = Math.floor( ( new Date() - date ) / 1000 );
    if ( 5 > b ) {
      return 'just now';
    } else if ( 60 > b ) {
      return b + ' seconds ago';
    } else if ( 3600 > b ) {
      date = Math.floor( b / 60 );
      return ( 1 < date ) ? date + ' minutes ago' : '1 minute ago';
    } else if ( 86400 > b ) {
      date = Math.floor( b / 3600 );
      return ( 1 < date ) ? date + ' hours ago' : '1 hour ago';
    } else if ( 172800 > b ) {
      date = Math.floor( b / 86400 );
      return ( 1 < date ) ? date + ' days ago' : '1 day ago';
    } else {
      return date.getDate().toString() + ' ' +
        getPugVar( 'months' ).split( ' ' )[ date.getMonth() ] + ', ' +
        date.getFullYear();
    }
  }

  async function runScenarios() {
    /**
     * The scenario stages where GIFs can be played.
     */
    const stages = document.querySelectorAll( '.scenario-stage' );

    /**
     * Index of the last displayed GIF.
     *
     * @type {number}
     */
    let lastScenarioIndex = -1;

    /**
     * Cache for storing Base64-encoded representations of GIFs.
     * Maps the URL of a GIF to its Base64-encoded string.
     *
     * @type {Object.<string, string>}
     */
    const base64GifCache = {};

    /**
     * Fetches the scenario manifest from beta.freeso.org
     *
     * @returns {Promise<Array<{id: string, url: string, description: string}>>} A promise that resolves to the array of GIF objects.
     */
    async function getAvailableScenarios() {
      try {
        const response = await fetch( getPugVar( 'scenarios-url' ) );
        const manifest = await response.json();
        return manifest.gifs;
      } catch ( err ) {
        console.error( 'error fetching scenarios', err );
        return [];
      }
    }

    /**
     * Fetches a GIF and converts it to a Base64-encoded string, if not cached.
     * If the fetch or conversion fails, logs the error and returns null (shows nothing).
     *
     * @param {string} url The URL of the GIF to fetch.
     *
     * @returns {Promise<string|null>} A promise that resolves with the Base64-encoded string of the GIF or null if an error occurs.
     */
    async function fetchGifAsBase64IfNeeded( url ) {
      try {
        // Return the Base64 string from cache if available.
        if ( base64GifCache[ url ] ) {
          return base64GifCache[ url ];
        }

        // Fetch and convert to Base64 if not in cache.
        const response = await fetch( url );
        const blob = await response.blob();
        return new Promise( ( resolve, reject ) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Data = reader.result;
            base64GifCache[ url ] = base64Data; // Cache it.
            resolve( base64Data );
          };
          reader.onerror = () => reject( 'Failed to convert blob to Base64.' );
          reader.readAsDataURL( blob );
        } );
      } catch ( err ) {
        console.error( `error fetching or converting GIF at ${url}:`, err );
        return null;
      }
    }

    /**
     * Generates a random index for the next scenario, ensuring it's not the same as the last one if possible.
     *
     * @param {number} scenarioCount - The total number of scenarios available.
     *
     * @returns {number} The index of the next GIF to display.
     */
    function getRandomScenarioIndex( scenarioCount ) {
      let newIndex;
      do {
        newIndex = Math.floor( Math.random() * scenarioCount );
      } while ( scenarioCount > 1 && newIndex === lastScenarioIndex ); // Ensure not to repeat the last GIF if there's more than one GIF.
      return newIndex;
    }

    /**
     * Displays a scenario selected randomly from the available list, ensuring
     * it's not the same as the last one displayed.
     *
     * @param {Array<{id: string, url: string, description: string}>} scenarios - An array of GIF objects to display.
     */
    async function displayRandomScenario( scenarios ) {
      if ( scenarios.length > 0 ) {
        const randomIndex = getRandomScenarioIndex( scenarios.length );
        lastScenarioIndex = randomIndex;
        const gif = scenarios[ randomIndex ];
        const base64Gif = await fetchGifAsBase64IfNeeded( gif.url );
        if ( base64Gif ) {
          stages.forEach( stage =>
            stage.style.backgroundImage = 'url(' + base64Gif.replace( 'image/gif','image/gif;rnd=' + Math.random() ) + ')'
          );
        }
      }
    }

    const scenarios = await getAvailableScenarios();
    if ( scenarios.length > 0 ) {
      await displayRandomScenario( scenarios ); // Display the first gif immediately.
      setInterval( async () => await displayRandomScenario( scenarios ), 30000 );
    }
  }

  /**
   * @param {string} theme The theme id.
   */
  function isDarkMode( theme ) {
    return getPugVar( 'dark-themes' ).includes( theme );
  }

  /**
   * @param {string} theme The theme id.
   * @param {boolean} forced If forced to change.
   */
  async function setTheme( theme, forced ) {
    const date = new Date();
    const m = date.getMonth();
    const d = date.getDate();
    if ( theme === 'auto' ) {
      // Snippet source: https://stackoverflow.com/questions/50730640/how-can-i-detect-if-dark-mode-is-enabled-on-my-website
      theme = window.matchMedia && window.matchMedia( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'open_beta';
    }
    if ( ! forced ) {
      // Halloween theme activates in October.
      if ( ( m == 9 && d >= 15 && d <= 31 ) || ( m == 10 && d == 1 ) ) {
        theme = 'halloween';
      }
      if ( getCurrentPage() === 'simitone' && ! isDarkMode( theme ) ) {
        theme = 'simitone';
      }
    }
    document.querySelector( 'body' ).className = theme;
  }

  /**
   * @param {string} id The toast id.
   * @param {string} message The toast body.
   */
  function toast( id, message ) {
    // remove previous toast if it exists
    removeToast( id );

    const template = document.querySelector( '#toast-template' );
    const node = document.importNode( template.content, true );

    node.querySelector( '.toast' ).id = id;
    node.querySelector( '.toast-message' ).textContent = message;
    node.querySelector( '.toast' ).style.display = 'block';

    document.querySelector( '#toasts' ).appendChild( node );
  }

  /**
   * @param {string} id The toast id.
   */
  function removeToast( id ) {
    const toast = document.getElementById( id );
    toast?.parentNode?.removeChild( toast );
  }

  async function fetchTrendingLots() {
    const trendingLotsUrl = getPugVar( 'trending-lots-url' );
    console.log('Fetching trending lots from URL:', trendingLotsUrl);
    const response = await fetch( trendingLotsUrl );
    const data = await response.json();
    console.log('Trending lots data received:', data);

    const avatarsOnlineElement = document.querySelector( '#now-trending .top span i' );
    const container = document.querySelector( '#now-trending ul' );

    // Update avatars online count
    avatarsOnlineElement.textContent = data.avatarsOnline;
    console.log('Updated avatars online count to:', data.avatarsOnline);

    // Clear existing lots
    container.innerHTML = '';

    console.log('Number of lots to display:', data.lots.length);

    // Iterating over lots to update the DOM
    data.lots.forEach( lot => {
      console.log('Processing lot:', lot.name, 'with', lot.avatars_in_lot, 'avatars');
      const lotTemplate = document.querySelector( '#now-trending-item-template' );
      const lotElement = document.importNode( lotTemplate.content, true );

      // Setting lot details
      lotElement.querySelector( '.lot-name' ).textContent = lot.name;
      lotElement.querySelector( '.owner span' ).textContent = lot.ownerDetails.name;
      lotElement.querySelector( '.players .count' ).textContent = lot.avatars_in_lot;
      lotElement.querySelector( '.icon img.lot' ).src = 'data:image/png;base64,' + lot.base64Image;
      lotElement.querySelector( '.icon .avatar' ).style.backgroundImage = 'url(data:image/png;base64,' + lot.ownerDetails.base64Image + ')';

      // Handling trending status
      if ( lot.is_trending ) {
        lotElement.querySelector( 'li' ).classList.add( 'hot' );
      } else {
        lotElement.querySelector( 'li' ).classList.remove( 'hot' );
      }

      // Adding the lot to the DOM
      container.appendChild( lotElement );
    } );
  }

  async function fetchBlog() {
    try {
      const blogUrl = getPugVar( 'blog-url' );
      console.log('Fetching blog from URL:', blogUrl);

      // For localhost URLs, use regular fetch. For external URLs, try CORS-free fetch first
      let response;
      if (blogUrl.includes('localhost') || blogUrl.includes('127.0.0.1')) {
        console.log('Using regular fetch for localhost URL');
        response = await fetch( blogUrl );
        console.log('Blog response status (regular):', response.status);
      } else {
        // Try CORS-free fetch first for external URLs, fallback to regular fetch
        try {
          response = await window.shared.fetchNoCors( blogUrl );
          console.log('Blog response status (no-CORS):', response.status);
        } catch ( corsError ) {
          console.log('CORS-free fetch failed, trying regular fetch:', corsError.message);
          response = await fetch( blogUrl );
          console.log('Blog response status (regular):', response.status);
        }
      }

      const data = await response.json();
      console.log('Blog data received:', data);
      const container = document.querySelector( '#blog-root' );

      // Clear existing articles
      container.innerHTML = '';

      // Check if we have articles array (proxy format) or direct posts array (WordPress API format)
      const articles = data.articles || data;
      console.log('Blog articles to process:', articles.length, 'articles');

      articles.forEach( article => {
        const articleTemplate = document.querySelector( '#article-template' );
        const articleElement = document.importNode( articleTemplate.content, true );
        // Handle both proxy format and direct WordPress API format
        let excerpt, title, date, link, author, imageUrl;

        if (article.excerpt && typeof article.excerpt === 'string') {
          // Proxy format
          excerpt = article.excerpt;
          title = article.title;
          date = article.date;
          link = article.link;
          author = article.author || 'Unknown';
          imageUrl = article.imageBase64 ? `data:image/png;base64,${article.imageBase64}` : null;
        } else {
          // WordPress API format
          const extractExcerpt = (htmlString) => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlString;
            return tempDiv.textContent || tempDiv.innerText || '';
          };
          excerpt = extractExcerpt(article.excerpt.rendered);
          title = article.title.rendered;
          date = article.date;
          link = article.link;
          author = article._embedded?.author?.[0]?.name || 'Unknown';
          imageUrl = article.jetpack_featured_media_url || article._embedded?.['wp:featuredmedia']?.[0]?.source_url;
        }

        // Clean excerpt
        excerpt = excerpt
          .replace( /\s{2,}/g, ' ' )
          .replace( /\n/g, '' )
          .replace( '&nbsp;', '' );

        // Setting article details
        articleElement.querySelector( '.article-title' ).textContent = title;
        articleElement.querySelector( '.article-date span' ).textContent = ago( new Date( date ) );
        const excerptElement = articleElement.querySelector( '.article-excerpt' );
        excerptElement.innerHTML = window.DOMPurify.sanitize( excerpt );
        const openInBrowserText = `Open “${title}” in a browser`;
        excerptElement.innerHTML = excerptElement.innerHTML.replace(
          '[...]',
          `<a target="_blank" href="${link}" title="${openInBrowserText}">[...]</a>`
        );

        articleElement.querySelector( '.article-author span' ).textContent = author;

        // Handle image
        let image = 'url(./images/city.jpg)'; // Default image
        if ( imageUrl ) {
          image = `url(${imageUrl})`;
        }
        articleElement.querySelector( '.article-image' ).style.backgroundImage = image;

        addEventListener( articleElement.querySelector( '.article-title' ),
          'click', () => window.open( link, '_blank' ) );

        addEventListener( articleElement.querySelector( '.article-image' ),
          'click', () => window.open( link, '_blank' ) );

        articleElement.querySelector( '.article-title' ).setAttribute( 'title', openInBrowserText );
        articleElement.querySelector( '.article-image' ).setAttribute( 'title', openInBrowserText );

        // Adding the article to the DOM
        container.appendChild( articleElement );
      } );
      document.querySelector( '#blog .alt-content' ).style.display = 'none';
    } catch ( err ) {
      console.error( 'error getting blog', err );
      console.error( 'Blog URL was:', getPugVar( 'blog-url' ) );
      document.querySelector( '#blog .alt-content' ).style.display = 'block';

      throw err;
    }
  }

  let spinDegrees = 0;

  /**
   * @param {string} id
   *
   * @returns string
   */
  function getPugVar( id ) {
    return document.body.getAttribute( 'data-' + id );
  }

  let isFetching = false;

  /**
   * @param {boolean} userRequested
   */
  async function fetchWidgetData( userRequested ) {
    if ( isFetching ) return; // Early return if a fetch is already in progress
    isFetching = true; // Set the flag to indicate fetching is in progress

    const didYouKnow = document.querySelector( '#widget' );
    const blog = document.querySelector( '#blog' );
    const spinner = document.querySelector( '#home-loading' );
    const homeRefreshBtn = document.querySelector( '#refresh-home-button' );
    const homeRefreshBtnIcon = homeRefreshBtn.querySelector( 'i' );

    didYouKnow.style.display = 'none';
    blog.style.display = 'none';
    spinner.style.display = 'block';

    homeRefreshBtn.setAttribute( 'disabled', 'disabled' );

    if ( userRequested ) {
      spinDegrees += 360;
      homeRefreshBtnIcon.style.transform = `rotate(${spinDegrees}deg)`;
    }

    const fetchTrendingLotsPromise = fetchTrendingLots();
    const fetchBlogPromise = fetchBlog();

    try {
      await Promise.all( [ fetchTrendingLotsPromise, fetchBlogPromise ] );
    } catch ( error ) {
      console.error( 'An error occurred while fetching widget data:', error );
    } finally {
      // Hide spinner and show content
      spinner.style.display = 'none';
      didYouKnow.style.display = 'block';
      blog.style.display = 'block';

      homeRefreshBtn.removeAttribute( 'disabled' );
      isFetching = false; // Reset the flag as the fetching is complete
    }
  }

  /**
   * @param {string} pageId The page id to show hints of.
   */
  function showHints( pageId ) {
    const hints = document.querySelectorAll( '[hint-page]' );
    for ( let i = 0; i < hints.length; i++ ) {
      hints[ i ].style.display = 'none';
    }
    const hintId = 'HINT_' + pageId;
    if ( ! localStorage[ hintId ] ) {
      const hints = document.querySelectorAll( `[hint-page="${pageId}"]` );
      for ( let j = 0; j < hints.length; j++ ) {
        hints[ j ].style.display = 'block';
        addEventListener( hints[ j ], 'click', e => {
          e.currentTarget.style.display = 'none';
        } );
      }
      localStorage.setItem( hintId, true );
    }
  }

  /**
   * @param {string} pageId The page id.
   */
  navigateTo = pageId => {
    const menuItems = document.querySelectorAll( 'li[page-trigger]' );
    for ( let i = 0; i < menuItems.length; i++ ) {
      menuItems[ i ].classList.remove( 'active' );
    }
    document.querySelector( `li[page-trigger="${pageId}"]` )
      .classList.add( 'active' );

    const pages = document.querySelectorAll( 'div.page' );
    for ( let j = pages.length - 1; 0 <= j; j-- ) {
      pages[ j ].style.display = 'none';
    }
    const newPage = document.querySelector( `#${pageId}-page` );
    newPage.style.display = 'block';

    focusContent( newPage );
    showHints( pageId );
    afterPageChange( pageId );
  };

  function addUnreadProgressItems() {
    const menuItem = document.querySelector( '[page-trigger="downloads"]' );
    totalUnreadProgressItems++;
    menuItem.classList.add( 'has-downloads' );
    menuItem.style.setProperty( '--unread-progress-items', `"${totalUnreadProgressItems}"` );
  }

  /**
   * @param {string} pageId The page id.
   */
  function afterPageChange( pageId ) {
    if ( pageId === 'simitone' ) {
      if ( document.querySelector( 'body' ).className !== 'simitone' ) {
        prevTheme = document.querySelector( 'body' ).className;
      }
      if ( ! isDarkMode( prevTheme ) ) { // Stay in dark theme.
        setTheme( 'simitone', true );
      }
      sendMessage( 'CHECK_SIMITONE' );

      simitoneInterval && clearInterval( simitoneInterval );
      simitoneInterval = setInterval( () => sendMessage( 'CHECK_SIMITONE' ), 60000 );
    } else {
      if ( prevTheme ) {
        setTheme( prevTheme );
        prevTheme = null;
      }
      if ( simitoneInterval ) {
        clearInterval( simitoneInterval );
        simitoneInterval = null;
      }
    }

    sendMessage( 'PAGE_CHANGE', pageId );
  }

  /**
   * @param {array} vars Array of unserialized configuration variables.
   */
  function restoreConfiguration( vars ) {
    for ( const section in vars )
      for ( const item in vars[ section ] ) {
        const option = document.querySelector( `[option-id="${section}.${item}"]` );
        if ( ( isDarwin || isLinux ) && item == 'GraphicsMode' )
          continue;
        option && ( option.value = vars[ section ][ item ] );
      }
  }

  /**
   * Creates or updates a full install progress item.
   *
   * @param {string} title    The title.
   * @param {string} text1    The text 1.
   * @param {string} text2    The text 2.
   * @param {number} progress The progress percentage number.
   */
  function fullInstallProgress( title, text1, text2, _progress ) {
    if ( ! ( title && text1 && text2 ) ) {
      return document.querySelector( '#full-install' ).style.display = 'none';
    }
    document.querySelector( '#full-install-title' ).textContent = title;
    document.querySelector( '#full-install-text1' ).textContent = text1;
    document.querySelector( '#full-install-text2' ).innerHTML = text2;
    document.querySelector( '#full-install-progress' ).style.width  = '100%';
    document.querySelector( '#full-install' ).style.display = 'block';
  }

  /**
   * Creates a notification item in the notification log.
   *
   * @param {string} title Notification title.
   * @param {string} body  Notification text.
   * @param {string} url   Notification url (optional).
   */
  function createNotification( title, body, url ) {
    document.querySelector( '#notifications-page .alt-content' ).style.display = 'none';

    const id = Math.floor( Date.now() / 1000 );
    const notificationElement = createNotificationElement( title, body, url );
    notificationElement.querySelector( '.notification' ).id = `FSONotification${id}`;

    const pageContent = document.querySelector( '#notifications-page .page-content' );
    pageContent.prepend( notificationElement );

    addEventListener( `#FSONotification${id} .notification-body`,
      'click', ( _e ) => {
        if ( url ) {
          window.open( url, '_blank' );
        }
      }, false );
  }

  function createNotificationElement( title, body, url ) {
    const template = document.querySelector( '#notification-template' );
    const notification = document.importNode( template.content, true );

    notification.querySelector( '.notification-title' )
      .textContent = title;
    notification.querySelector( '.notification-body' )
      .innerHTML = window.DOMPurify.sanitize( body );
    notification.querySelector( '.notification-time' )
      .textContent = new Date().toLocaleString();

    const notificationLink = notification.querySelector( '.notification-link' );
    if ( url ) {
      notificationLink.href = url;
    } else {
      notificationLink.remove();
    }

    return notification;
  }

  /**
   * @param {string} elId
   * @param {string} title
   * @param {string} subtitle
   * @param {string} progressText
   * @param {number} percentage
   */
  function createOrModifyProgressItem( elId, title, subtitle, progressText, percentage ) {
    document.querySelector( '#downloads-page .alt-content' ).style.display = 'none';
    let progressItem = document.getElementById( elId );

    if ( ! progressItem ) {
      const progressItemElement = ( elId => {
        const template = document.querySelector( '#progress-item-template' );
        const progressItem = document.importNode( template.content, true );
        progressItem.querySelector( '.download' ).id = elId;
        return progressItem;
      } )( elId );
      progressItem = progressItemElement.querySelector( '.download' );
      document.querySelector( '#downloads-page .page-content' )
        .insertAdjacentElement( 'afterbegin', progressItem );

      addUnreadProgressItems();
    }
    progressItem.querySelector( '.progress' ).style.width = percentage + '%';
    progressItem.querySelector( '.progress-title' ).innerHTML = title;
    progressItem.querySelector( '.progress-subtitle' ).innerHTML = subtitle;
    progressItem.querySelector( '.progress-info' ).innerHTML = progressText;
    progressItem.querySelector( '.loading' ).style.display = 'block';
  }

  /**
   * @param {string} title       The Modal window title.
   * @param {string} text        The main Modal text.
   * @param {string} yesText     The text for an affirmative button.
   * @param {string} noText      The text for a negative response button.
   * @param {string} modalRespId Unique Modal response ID if you want to receive the response in code.
   * @param {string} extra       Extra parameters.
   * @param {string} type        Modal type (success/error/empty)
   */
  function yesNo( title, text, yesText, noText, modalRespId, extra, type ) {
    if ( type == 'success' ) {
      okAudio.play();
    } else {
      modalAudio.play();
    }
    if ( modalRespId == 'FULL_INSTALL_CONFIRM' && isWindows ) {
      return openOneClickInstall(); // Has its custom modal
    }
    const modalElement = createYesNoModalElement( title, text, yesText, noText, type, modalRespId );
    const modalDiv  = modalElement.querySelector( '.modal' );
    const yesButton = modalElement.querySelector( '.yes-button' );
    const noButton  = modalElement.querySelector( '.no-button' );

    addEventListener( yesButton, 'click', function () {
      closeModal( modalDiv );
      modalRespId && sendMessage( modalRespId, ! 0, extra );
    } );
    if ( noText ) {
      addEventListener( noButton, 'click', function () {
        closeModal( modalDiv );
        modalRespId && sendMessage( modalRespId, ! 1, extra );
      } );
    }
    document.querySelector( '#launcher' ).appendChild( modalElement );

    showModal( modalDiv );
  }

  function createYesNoModalElement( title, text, yesText, noText, type, modalRespId ) {
    const modalTemplate = document.querySelector( '#yes-no-modal-template' );
    const modalElement  = document.importNode( modalTemplate.content, true );

    if ( modalRespId ) {
      modalElement.querySelector( '.modal' ).setAttribute( 'data-response-id', modalRespId );
    }
    modalElement.querySelector( '.modal-header' ).innerHTML = title;
    modalElement.querySelector( '.modal-text' ).innerHTML = text;
    modalElement.querySelector( '.yes-button' ).innerHTML = yesText;

    if ( type ) {
      modalElement.querySelector( '.modal' ).classList.add( `modal-${type}` );
    }
    if ( noText ) {
      modalElement.querySelector( '.no-button' ).innerHTML = noText;
    } else {
      modalElement.querySelector( '.no-button' ).remove();
      modalElement.querySelector( '.yes-button' ).style.margin = '0px';
    }
    return modalElement;
  }

  function clearInstallerHints() {
    const hints = document.querySelectorAll( '[hint-page="installer"]' );
    for ( let j = 0; j < hints.length; j++ ) {
      hints[ j ].style.display = 'none';
    }
  }

  function clearModals() {
    const modals = document.querySelectorAll( '.overlay-closeable' );
    for ( let j = 0; j < modals.length; j++ ) {
      closeModal( modals[ j ] );
    }
  }

  function closeModal( element ) {
    if ( element.classList.contains( 'modal' ) ) {
      element.parentNode.removeChild( element );
    } else {
      element.style.display = 'none';
    }
    hideOverlay();
  }

  function showModal( element ) {
    if ( ! element.classList.contains( 'modal' ) ) {
      element.style.display = 'block';
    }
    showOverlay();
    focusContent( element );
  }

  function focusContent( element ) {
    const focusables = element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]'
    );
    if ( focusables.length > 0 ) {
      setTimeout( () => focusables[ 0 ].focus(), 0 );
    }
  }

  function hideOverlay() {
    const overlayUsing = document.querySelectorAll( '.overlay-closeable' );
    if ( overlayUsing.length === 0 || ( ! Array.from( overlayUsing ).some( isVisible ) ) ) {
      document.querySelector( '#overlay' ).style.display = 'none';
    }
  }

  function showOverlay() {
    document.querySelector( '#overlay' ).style.display = 'block';
  }

  let ociFolder;

  function openOneClickInstall() {
    const oci = document.querySelector( '.oneclick-install' );
    oci.classList.remove( 'oneclick-install-selected' );
    showModal( oci );
  }

  closeOneClickInstall = () => {
    closeModal( document.querySelector( '.oneclick-install' ) );
  };

  ociPickFolder = () => {
    sendMessage( 'OCI_PICK_FOLDER' );
  };

  ociConfirm = e => {
    e.stopPropagation();
    if ( ociFolder ) {
      sendMessage( 'FULL_INSTALL_CONFIRM', true );
      closeModal( document.querySelector( '.oneclick-install' ) );
    }
  };

  function ociPickedFolder( folder ) {
    ociFolder = folder;
    const oci = document.querySelector( '.oneclick-install' );
    const ociFolderElement = document.querySelector( '.oneclick-install-folder' );
    oci.classList.add( 'oneclick-install-selected' );
    ociFolderElement.innerHTML = folder;
    ociFolder = folder;
  }

  function isVisible( element ) {
    const style = window.getComputedStyle( element );
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function filterHz( value, minValue, maxValue ) {
    const intVal = parseInt( value );
    if ( intVal < minValue ) {
      return minValue;
    } else if ( intVal > maxValue ) {
      return maxValue;
    }
    return intVal;
  }

  function toggleKeyboardUser( e ) {
    if ( e.type === 'keydown' && e.key === 'Tab' ) {
      document.body.setAttribute( 'data-keyboard-user', '' );
    } else if ( e.type === 'mousedown' ) {
      document.body.removeAttribute( 'data-keyboard-user' );
    }
  }

  function searchForNavigationTriggers( e ) {
    // Starting from the event target, climb up the DOM tree
    // until we find an element with the 'data-navigate-to' attribute
    // or until we reach the body element.
    let target = e.target;
    while ( target && target !== document.body ) {
      if ( target.hasAttribute( 'data-navigate-to' ) ) {
        // Found an element with the 'data-navigate-to' attribute.
        // Retrieve the attribute value and use it for navigation.
        const destination = target.getAttribute( 'data-navigate-to' );
        navigateTo( destination );
        // Prevent the default action if the navigation is handled.
        e.preventDefault();
        return; // Stop the loop and exit the function
      }
      // Move up to the parent element and check again.
      target = target.parentElement;
    }
  }

  // Events received from the main process.
  // HAS_INTERNET
  onMessage( 'HAS_INTERNET', () => {
    document.body.classList.remove( 'no-internet' );
  } );
  // NO_INTERNET
  onMessage( 'NO_INTERNET', () => {
    document.body.classList.remove( 'no-internet' );
    document.body.classList.add( 'no-internet' );
  } );
  // REMESH_INFO
  onMessage( 'REMESH_INFO', ( a, v ) => {
    if ( ! v ) return;

    document.querySelector( '#remeshinfo' ).style.display = 'block';

    const template = document.querySelector( '#remesh-info-template' );
    const node = document.importNode( template.content, true );

    const i = parseInt( v );
    const f = ago( new Date( i * 1000 ) );
    const seconds = Math.floor( ( new Date() - new Date( i * 1000 ) ) / 1000 );

    node.querySelector( 'span' ).textContent = f;

    if ( seconds < 172800 ) {
      if ( Math.floor( seconds / 86400 ) <= 1 ) {
        document.querySelector( '.item[install="RMS"]' ).classList.add( 'recent' );
      } else {
        document.querySelector( '.item[install="RMS"]' ).classList.remove( 'recent' );
      }
    } else {
      document.querySelector( '.item[install="RMS"]' ).classList.remove( 'recent' );
    }

    document.querySelector( '#remeshinfo' ).innerHTML = '';
    document.querySelector( '#remeshinfo' ).appendChild( node );
  } );
  // OCI_PICKED_FOLDER
  onMessage( 'OCI_PICKED_FOLDER', ( a, folder ) => {
    if ( ! folder ) return;
    ociPickedFolder( folder );
  } );
  // SIMITONE_SHOULD_UPDATE
  onMessage( 'SIMITONE_SHOULD_UPDATE', ( a, b ) => {
    if ( ! b ) {
      simitoneUpdate = null;
      return simitoneShouldntUpdate();
    }
    simitoneUpdate = b;
    simitoneShouldUpdate();
  } );
  onMessage( 'SIMITONE_SET_VER', ( a, b ) => {
    if ( b ) {
      document.querySelector( '#simitone-ver' ).textContent = `(Installed: ${b})`;
    } else {
      document.querySelector( '#simitone-ver' ).textContent = '';
    }
  } );
  // SET_THEME
  onMessage( 'SET_THEME', ( a, themeId ) => ( setTheme( themeId ), prevTheme = null ) );
  // SET_TIP
  onMessage( 'SET_TIP', ( a, tipText ) => {
    document.querySelector( '#tip-text' ).innerHTML = window.DOMPurify.sanitize( tipText );
  } );
  // TOAST
  onMessage( 'TOAST', ( a, t, c ) => toast( t, c ) );
  // NOTIFLOG
  onMessage( 'NOTIFLOG', ( a, t, l, c ) => createNotification( t, l, c ) );
  // REMOVE_TOAST
  onMessage( 'REMOVE_TOAST', ( a, t ) => removeToast( t ) );
  // POPUP
  onMessage( 'POPUP', ( a, b, c, e, f, g, d, h ) => yesNo( b, c, e, f, g, d, h ) );
  // RESTORE_CONFIGURATION
  onMessage( 'RESTORE_CONFIGURATION', ( a, b ) => restoreConfiguration( b ) );
  // CHANGE_PAGE
  onMessage( 'CHANGE_PAGE', ( a, b ) => navigateTo( b ) );
  // INSPROG
  onMessage( 'INSPROG', ( a, b ) => {
    if ( !b ) return;

    // Debug log to check what's being received
    console.log('Installation status update received:', b);

    // Handle LSO status - Change FSO to LSO in the selector
    const lsoElement = document.querySelector('.item[install=LSO]');  // Changed from FSO to LSO
    if (b.LSO) {
        lsoElement.className = 'item installed';
        console.log('LSO is installed');
    } else {
        lsoElement.className = 'item';
        console.log('LSO is not installed');
    }

    // Handle TSO status
    const tsoElement = document.querySelector('.item[install=TSO]');
    if (b.TSO) {
        tsoElement.className = 'item installed';
        console.log('TSO is installed');
    } else {
        tsoElement.className = 'item';
        console.log('TSO is not installed');
    }
  } );
  // STOP_PROGRESS_ITEM
  onMessage( 'STOP_PROGRESS_ITEM', ( a, b ) => {
    const item = document.querySelector( `#${b}` );
    if ( item ) {
      item.className = 'download stopped';
    }
  } );
  // PLAY_SOUND
  onMessage( 'PLAY_SOUND', ( a, b ) => {
    const audio = new window.Howl( { src: `sounds/${b}.wav`, volume: 0.4 } );
    audio.play();
  } );
  // CREATE_PROGRESS_ITEM
  onMessage( 'CREATE_PROGRESS_ITEM', ( a, b, c, e, f, g, d ) =>
    createOrModifyProgressItem( b, c, e, f, g, d ) );
  // FULL_INSTALL_PROGRESS_ITEM
  onMessage( 'FULL_INSTALL_PROGRESS_ITEM', ( a, b, c, e, f ) =>
    fullInstallProgress( b, c, e, f ) );
  // MAX_REFRESH_RATE
  onMessage( 'MAX_REFRESH_RATE', ( a, rate ) => {
    if ( rate ) {
      document.querySelector( '[option-id="Game.RefreshRate"]' )
        .setAttribute( 'max', rate );
    }
  } );

  // Renderer HTML event listeners.
  addEventListener( '.launch',                   'click',       () => sendMessage( 'PLAY' ) );
  addEventListener( '.launch',                   'contextmenu', () => sendMessage( 'PLAY', true ) );
  addEventListener( '#refresh-home-button',      'click',       () => fetchWidgetData( true ) );
  addEventListener( '#simitone-play-button',     'click',       () => sendMessage( 'PLAY_SIMITONE' ) );
  addEventListener( '#simitone-play-button',     'contextmenu', () => sendMessage( 'PLAY_SIMITONE', true ) );
  addEventListener( '#full-install-button',      'click',       () => sendMessage( 'FULL_INSTALL' ) );
  addEventListener( '#full-install-button',      'click',       () => clearInstallerHints() );
  addEventListener( '#update-check',             'click',       () => sendMessage( 'CHECK_UPDATES' ) );
  addEventListener( '#simitone-install-button',  'click',       () => sendMessage( 'INSTALL', 'Simitone' ) );
  addEventListener( '#simitone-should-update',   'click',       () => sendMessage( 'INSTALL_SIMITONE_UPDATE' ) );
  addEventListener( '#overlay',                  'click',       () => clearModals() );
  addEventListener( '.oneclick-install-select',  'click',       () => ociPickFolder() );
  addEventListener( '.oneclick-install-close',   'click',       () => closeOneClickInstall() );
  addEventListener( '.oneclick-install-confirm', 'click',       e => ociConfirm( e ) );
  addEventListener( document.body,               'keydown',     e => toggleKeyboardUser( e ) );
  addEventListener( document.body,               'mousedown',   e => toggleKeyboardUser( e ) );
  addEventListener( document.body,               'click',       e => searchForNavigationTriggers( e ) );
  addEventListener( '#control-minimize',         'click',       () => sendMessage( 'TITLEBAR_MINIMIZE' ) );
  addEventListener( '#control-close',            'click',       () => sendMessage( 'TITLEBAR_CLOSE' ) );
  addEventListener( '#scan-for-games-btn',       'click',       () => sendMessage( 'SCAN_FOR_GAMES' ) );

  // Disable click for installation path tag
  document.querySelectorAll( '.item-info' ).forEach( function ( item ) {
    item.addEventListener( 'click', function ( event ) {
      event.stopPropagation();
    } );
  } );

  addEventListenerAll( '[option-id]', 'change', ( event, _b ) => {
    const currentTarget = event.currentTarget;
    const optionId = currentTarget.getAttribute( 'option-id' );
    let inputValue = currentTarget.value;

    if ( optionId === 'Launcher.Theme' ) {
      setTheme( inputValue );
    }
    if ( optionId === 'Game.RefreshRate' ) {
      const min = currentTarget.getAttribute( 'min' );
      const max = currentTarget.getAttribute( 'max' );
      if ( ! inputValue ) {
        inputValue = currentTarget.value = max;
      } else {
        const hz = filterHz( inputValue, min, max );
        if ( hz != inputValue ) {
          inputValue = currentTarget.value = hz;
        }
      }
    }
    const optionPath = optionId.split( '.' );

    sendMessage( 'SET_CONFIGURATION', [ optionPath[ 0 ], optionPath[ 1 ], inputValue ] );
  } );
  addEventListenerAll( '[page-trigger]', 'click', ( a, _b ) => {
    clickAudio.play();
    navigateTo( a.currentTarget.getAttribute( 'page-trigger' ) );
  } );
  addEventListenerAll( '[install]', 'click', ( a, _b ) =>
    sendMessage( 'INSTALL', a.currentTarget.getAttribute( 'install' ) ) );
  addEventListenerAll( '[install] .item-info i.material-icons', 'click', ( a, _b ) =>
    sendMessage( 'OPEN_FOLDER', a.currentTarget.closest( '.item' ).getAttribute( 'install' ) ) );

  run();
} )();




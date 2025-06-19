require('fix-path')(); // Fix $PATH on darwin
require('v8-compile-cache');

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { spawn } = require('child_process');

// Safe console logging for packaged apps to prevent EPIPE errors
const originalConsole = { ...console };
const safeConsole = {
  info: (...args) => {
    try {
      originalConsole.info(...args);
    } catch (err) {
      // Silently ignore console errors in packaged apps
    }
  },
  error: (...args) => {
    try {
      originalConsole.error(...args);
    } catch (err) {
      // Silently ignore console errors in packaged apps
    }
  },
  warn: (...args) => {
    try {
      originalConsole.warn(...args);
    } catch (err) {
      // Silently ignore console errors in packaged apps
    }
  },
  log: (...args) => {
    try {
      originalConsole.log(...args);
    } catch (err) {
      // Silently ignore console errors in packaged apps
    }
  }
};

// Replace console with safe version in packaged apps
if (process.env.NODE_ENV === 'production' || process.defaultApp === false) {
  Object.assign(console, safeConsole);
}

// 🔧 Setup the Electron cache/userData path BEFORE requiring 'electron'
const userDataPath = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'LegacySO_Launcher_UserData')
  : path.join(os.homedir(), '.legacyso-launcher');
const cachePath = path.join(userDataPath, 'cache');
const tempPath = path.join(userDataPath, 'temp');

try {
  fs.ensureDirSync(userDataPath);
  fs.ensureDirSync(cachePath);
  fs.ensureDirSync(tempPath);

  // Set permissions on Windows to avoid access denied errors
  if (process.platform === 'win32') {
    try {
      fs.chmodSync(userDataPath, 0o755);
      fs.chmodSync(cachePath, 0o755);
      fs.chmodSync(tempPath, 0o755);
    } catch (permErr) {
      console.warn('Could not set directory permissions:', permErr.message);
    }
  }

  process.env.ELECTRON_USER_DATA_PATH = userDataPath;
  console.info('Electron user data path set to:', userDataPath);
} catch (err) {
  console.error('Failed to create Electron data path:', err);
  // Fallback to default behavior
}

const {
  app,
  BrowserWindow,
  shell,
  Tray,
  Menu,
  nativeImage,
  nativeTheme
} = require('electron');

const { initSentry, enableFileLogger } = require('./fsolauncher/lib/utils');

// Disable GPU cache and other cache-related issues
app.commandLine.appendSwitch('disable-gpu-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// init Sentry error logging as soon as possible
initSentry();

const compilePugFiles = require('./fsolauncher/lib/pug-compiler');

const {
  appData,
  version,
  darkThemes,
  resourceCentral,
  isTestMode,
  fileLogEnabled,
  devToolsEnabled,
  defaultRefreshRate,
  defaultGameLanguage,
  homeDir
} = require('./fsolauncher/constants');

if (fileLogEnabled) {
  enableFileLogger();
  console.info('file logger enabled');
}

if (isTestMode && process.platform !== 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('--no-sandbox');
}

const { locale, setLocale } = require('./fsolauncher/lib/locale');

const oslocale = require('os-locale'),
  ini = require('ini');

const FSOLauncher = require('./fsolauncher/fsolauncher');

process.title = 'LegacySO Launcher';

global.willQuit = false;

const prevOpenExternal = shell.openExternal;
shell.openExternal = Object.freeze(url => {
  if (url.startsWith('http') || url.startsWith('https')) {
    prevOpenExternal(url);
  }
});
Object.freeze(shell);

fs.ensureDirSync(appData + '/temp');

let window;
let tray;
let launcher;
let trayIcon;
let userSettings;
let proxyProcess;

try {
  userSettings = ini.parse(fs.readFileSync(appData + '/FSOLauncher.ini', 'utf-8'));
} catch (err) {
  userSettings = {
    Launcher: {
      Theme: 'auto',
      DesktopNotifications: '1',
      Persistence: ['darwin', 'linux'].includes(process.platform) ? '0' : '1',
      DirectLaunch: '0',
      Language: 'default'
    },
    Game: {
      GraphicsMode: process.platform === 'win32' ? 'dx' : 'ogl',
      Language: defaultGameLanguage
    }
  };
  fs.writeFileSync(appData + '/FSOLauncher.ini', ini.stringify(userSettings), 'utf-8');
}
console.info('loaded userSettings', userSettings);

function loadLocale(settings) {
  let langCode = settings.Launcher.Language;
  if (!langCode || langCode === 'default') {
    langCode = oslocale.sync().substring(0, 2);
  }
  setLocale(langCode, {
    CSP_STRING: require('./csp.config'),
    LAUNCHER_VERSION: version,
    ELECTRON_VERSION: process.versions.electron,
    LAUNCHER_THEME: settings.Launcher.Theme === 'auto' ? nativeTheme.shouldUseDarkColors ? 'dark' : 'open_beta' : settings.Launcher.Theme,
    PLATFORM: process.platform,
    DARK_THEMES: darkThemes.join(','),
    SENTRY: require('./sentry.config').browserLoader,
    LANG_CODE: langCode,
    DEFAULT_REFRESH_RATE: defaultRefreshRate,
    REMESH_PACKAGE_CREDITS: require('./fsolauncher-ui/remesh-package.json'),
    PRELOADED_FONTS: require('./fonts.config'),
    WS_URL: resourceCentral.WS,
    TRENDING_LOTS_URL: resourceCentral.TrendingLots,
    SCENARIOS_URL: resourceCentral.Scenarios,
    SIMITONE_PLATFORM_PATH: appData.replace(homeDir, '~') + '/GameComponents/The Sims',
    BLOG_URL: resourceCentral.Blog
  });
}
loadLocale(userSettings);

const options = {};

function showWindow() {
  console.info('Showing window, isTestMode:', isTestMode);
  if (!window) {
    console.error('Cannot show window: window is null');
    return;
  }
  if (isTestMode) {
    console.info('Test mode active, not showing window');
  } else {
    console.info('Showing window');
    window.show();
  }
}

function startProxyServer() {
  try {
    console.info('Starting embedded proxy server...');

    // Start the proxy server directly in the main process
    startEmbeddedProxyServer();
  } catch (error) {
    console.error('Failed to start proxy server:', error);
    // Fallback to external process
    startProxyServerAlternative();
  }
}

function startEmbeddedProxyServer() {
  try {
    // Use built-in Node.js modules for better compatibility
    const http = require('http');
    const url = require('url');
    const axios = require('axios');

    const port = 30632;
    const lotsUpdateInterval = 5; // minutes
    const blogUpdateInterval = 60; // 1 req every hour

    // Cache for trending lots
    let trendingLots = [];
    let avatarsOnline = 0;
    let lastUpdateTime = 0;
    const cachedBlogData = [];

    const getImageAsBase64 = async (url) => {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 5000,
          validateStatus: function (status) {
            return status >= 200 && status < 300;
          }
        });
        return Buffer.from(response.data, 'binary').toString('base64');
      } catch (error) {
        if (error.response && (error.response.status === 404 || error.response.status === 400)) {
          return null;
        } else {
          console.warn('Image fetch error:', { url, message: error.message });
          return null;
        }
      }
    };

    const updateTrendingLots = async () => {
      try {
        console.info('Updating trending lots...');

        // Get avatars online
        const avatarsOnlineResponse = await axios.get('https://api.legacyso.org/userapi/avatars/online?compact=true');
        avatarsOnline = avatarsOnlineResponse.data.avatars_online_count;
        console.info('Avatars online:', avatarsOnline);

        // Get online lots
        const onlineLotsResponse = await axios.get('https://api.legacyso.org/userapi/city/1/lots/online');
        const onlineLots = onlineLotsResponse.data.lots;
        console.info('Found online lots:', onlineLots ? onlineLots.length : 0);

        if (!onlineLots || onlineLots.length === 0) {
          console.warn('No online lots found');
          trendingLots = [];
          lastUpdateTime = Date.now();
          return;
        }

        // Sort by avatars_in_lot and pick the top 10
        const sortedLots = onlineLots.sort((a, b) => b.avatars_in_lot - a.avatars_in_lot).slice(0, 10);
        console.info('Top lots:', sortedLots.map(lot => `${lot.location} (${lot.avatars_in_lot} avatars)`));

        // Get additional details for each lot
        for (let lot of sortedLots) {
          try {
            const lotDetailsResponse = await axios.get(`https://api.legacyso.org/userapi/city/1/lots/location/${lot.location}`);
            const ownerId = lotDetailsResponse.data.owner_id;

            if (ownerId) {
              const ownerDetailsResponse = await axios.get(`https://api.legacyso.org/userapi/avatars/?ids=${ownerId}`);
              lot.ownerDetails = ownerDetailsResponse.data.avatars[0] || { name: 'Unknown', id: ownerId };
            } else {
              lot.ownerDetails = { name: 'Unknown', id: 0 };
            }

            // Fetch and attach the base64 image for the lot (silently handle missing images)
            const lotImageUrl = `https://api.legacyso.org/userapi/city/1/${lot.location}.png`;
            lot.base64Image = await getImageAsBase64(lotImageUrl);

            // Fetch and attach the base64 image for the owner's avatar (silently handle missing images)
            if (ownerId) {
              const avatarImageUrl = `https://api.legacyso.org/userapi/avatars/${ownerId}.png`;
              lot.ownerDetails.base64Image = await getImageAsBase64(avatarImageUrl);
            }

            lot.is_trending = lot.avatars_in_lot >= 8;
          } catch (lotError) {
            console.warn(`Failed to get details for lot ${lot.location}:`, lotError.message);
            // Continue with basic lot data even if details fail
            lot.ownerDetails = { name: 'Unknown', id: 0 };
            lot.base64Image = null;
            lot.is_trending = lot.avatars_in_lot >= 8;
          }
        }

        trendingLots = sortedLots;
        lastUpdateTime = Date.now();
        console.info('Trending lots updated successfully:', trendingLots.length, 'lots');
      } catch (error) {
        console.error('Failed to update trending lots:', error);
        // Set empty data on error
        trendingLots = [];
        avatarsOnline = 0;
        lastUpdateTime = Date.now();
      }
    };

    const extractExcerpt = content => {
      const targetLength = 125;
      const strippedContent = content.replace(/(<([^>]+)>)/gi, '').trim();

      if (strippedContent.length <= targetLength) {
        return strippedContent;
      }

      let endIndex = strippedContent.lastIndexOf(' ', targetLength);
      if (endIndex === -1) {
        endIndex = targetLength;
      }

      return strippedContent.substring(0, endIndex) + ' [...]';
    };

    const updateBlogFeed = async () => {
      try {
        const feedUrl = 'https://legacyso.org/wp-json/wp/v2/posts?_embed&per_page=10';
        const response = await axios.get(feedUrl);
        const posts = response.data;

        const items = await Promise.all(posts.map(async post => {
          const title = post.title.rendered;
          const link = post.link;
          let imageUrl = post.jetpack_featured_media_url || '';
          if (imageUrl) {
            imageUrl = imageUrl.replace(
              'https://legacyso.org/wp-content/uploads',
              'https://i0.wp.com/legacyso.org/wp-content/uploads'
            );
            imageUrl += '?resize=350,200&ssl=1';
          }
          const excerpt = extractExcerpt(post.excerpt.rendered);
          const date = post.date;
          const authorId = post.author;
          const imageBase64 = imageUrl ? await getImageAsBase64(imageUrl) : null;

          return {
            title,
            link,
            imageUrl,
            imageBase64,
            excerpt,
            date,
            author: authorId
          };
        }));

        cachedBlogData.length = 0;
        cachedBlogData.push(...items);
      } catch (error) {
        console.error('Failed to fetch and process blog feed from WordPress JSON API:', error);
      }
    };

    // Schedule updates
    setInterval(updateTrendingLots, lotsUpdateInterval * 60 * 1000);
    updateTrendingLots();

    setInterval(updateBlogFeed, blogUpdateInterval * 60 * 1000);
    updateBlogFeed();

    // Create HTTP server
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      console.info('Proxy request:', req.method, parsedUrl.pathname);

      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');

      if (parsedUrl.pathname === '/trending-lots') {
        console.info('Serving trending lots:', trendingLots.length, 'lots, avatars online:', avatarsOnline);
        res.writeHead(200);
        res.end(JSON.stringify({
          lastUpdate: lastUpdateTime,
          lotCount: trendingLots.length,
          avatarsOnline,
          lots: trendingLots
        }));
      } else if (parsedUrl.pathname === '/blog') {
        console.info('Serving blog articles:', cachedBlogData.length, 'articles');
        res.writeHead(200);
        res.end(JSON.stringify({ articles: cachedBlogData }));
      } else {
        console.warn('Unknown endpoint requested:', parsedUrl.pathname);
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    // Start the server
    server.listen(port, () => {
      console.info(`Embedded proxy server running on port ${port}`);
    });

    // Store server reference for cleanup
    global.proxyServer = server;

  } catch (error) {
    console.error('Failed to start embedded proxy server:', error);
    // Fallback to external process
    startProxyServerAlternative();
  }
}

function startProxyServerAlternative() {
  try {
    // Use the same path logic as the main function
    let proxyPath;

    if (app.isPackaged) {
      proxyPath = path.join(process.resourcesPath, 'fsolauncher-proxy');
    } else {
      proxyPath = path.join(__dirname, '../extras/fsolauncher-proxy');
    }

    const scriptPath = path.join(proxyPath, 'src/index.js');

    console.info('Starting proxy server...');
    console.info('Script path:', scriptPath);
    console.info('Working directory:', proxyPath);

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      console.error('Proxy script not found:', scriptPath);
      return;
    }

    // Try multiple approaches to start Node.js
    let nodePath = 'node'; // Default to system Node.js

    // Try to find Node.js in common locations
    const possibleNodePaths = [
      'node',
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
      path.join(process.env.PROGRAMFILES || '', 'nodejs', 'node.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'nodejs', 'node.exe')
    ];

    // Find the first available Node.js executable
    for (const nodePath of possibleNodePaths) {
      try {
        if (nodePath === 'node' || fs.existsSync(nodePath)) {
          console.info('Trying Node.js at:', nodePath);

          proxyProcess = spawn(nodePath, [scriptPath], {
            cwd: proxyPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            env: { ...process.env },
            shell: true // Use shell to help find node
          });

          proxyProcess.stdout.on('data', (data) => {
            console.info('Proxy server:', data.toString().trim());
          });

          proxyProcess.stderr.on('data', (data) => {
            console.error('Proxy server error:', data.toString().trim());
          });

          proxyProcess.on('close', (code) => {
            console.info(`Proxy server exited with code ${code}`);
          });

          proxyProcess.on('error', (error) => {
            console.error('Failed to start proxy server:', error);
          });

          console.info('Proxy server started with PID:', proxyProcess.pid);
          return; // Success, exit the function
        }
      } catch (err) {
        console.warn('Failed to start with', nodePath, ':', err.message);
        continue; // Try next path
      }
    }

    console.error('Could not find Node.js executable to start proxy server');
  } catch (error) {
    console.error('Alternative proxy server startup failed:', error);
  }
}

async function createWindow() {
  try {
    console.info('Starting window creation process');
    compilePugFiles({ pretty: false }, () => locale.current);
    console.info('Pug files compiled');

    trayIcon = nativeImage.createFromPath(
      path.join(__dirname, ['darwin', 'linux'].includes(process.platform) ? 'beta.png' : 'beta.ico')
    );
    if (['darwin', 'linux'].includes(process.platform)) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
    tray = new Tray(trayIcon);
    console.info('Tray icon created');

    const width = 1090 + 8;
    const height = 646 + 12 + 30;

    Object.assign(options, {
      transparent: true,
      minWidth: width,
      minHeight: height,
      maxWidth: width,
      maxHeight: height,
      center: true,
      maximizable: false,
      width: width,
      height: height,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      title: 'LegacySO Launcher ' + version,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: isTestMode,
        preload: path.join(__dirname, './fsolauncher-ui/preload.js')
      }
    });

    console.info('Creating browser window with options:', options);
    window = new BrowserWindow(options);
    window.setMenu(null);

    if (devToolsEnabled && !isTestMode) {
      console.info('devtools enabled');
      window.openDevTools({ mode: 'detach' });
    }

    console.info('Loading URL:', `file://${__dirname}/fsolauncher-ui/fsolauncher.pug`);
    window.loadURL(`file://${__dirname}/fsolauncher-ui/fsolauncher.pug`);

    window.on('hide', () => process.platform === 'win32' && window.setSize(width, height));
    window.on('restore', () => process.platform === 'win32' && window.setSkipTaskbar(false));

    console.info('Creating FSOLauncher instance');
    launcher = new FSOLauncher({
      window,
      userSettings,
      onReload: async settings => {
        loadLocale(settings);
        window.reload();
      }
    });

    if (process.platform === 'darwin') {
      const darwinAppMenu = require('./fsolauncher/lib/darwin-app-menu');
      Menu.setApplicationMenu(Menu.buildFromTemplate(darwinAppMenu(app.getName(), launcher)));
    }

    tray.setToolTip(`LegacySO Launcher ${version}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: locale.current.TRAY_LABEL_1,
        click: () => launcher.launchGame()
      },
      { type: 'separator' },
      {
        label: locale.current.TRAY_LABEL_2,
        click: () => {
          global.willQuit = true;
          window?.close();
        }
      }
    ]));

    tray.on('click', () => {
      if (!window) return;
      if (window.isVisible()) {
        if (['darwin', 'linux'].includes(process.platform)) {
          window.minimize();
        } else {
          window.hide();
        }
      } else {
        showWindow();
      }
    });

    window.on('closed', () => window = null);

    window.once('ready-to-show', () => {
      console.info('Window ready to show');
      launcher.updateInstalledPrograms().then(() => {
        console.info('Programs updated, DirectLaunch:', userSettings.Launcher.DirectLaunch, 'LSO installed:', launcher.isInstalled.LSO);
        if (userSettings.Launcher.DirectLaunch === '1' && launcher.isInstalled.LSO) {
          launcher.launchGame();
          if (['darwin', 'linux'].includes(process.platform)) {
            showWindow();
          }
        } else {
          showWindow();
        }
      }).catch(err => {
        console.error('Error updating installed programs:', err);
        showWindow();
      });
    });

    window.on('close', e => {
      if (!global.willQuit && launcher.userSettings.Launcher.Persistence === '1') {
        e.preventDefault();
        window.minimize();
      }
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Add error handler for window loading
    window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Failed to load window content:', errorCode, errorDescription);
    });
  } catch (error) {
    console.error('Error in createWindow:', error);
  }
}

app.on('ready', () => {
  console.info('App ready event triggered');

  // Set app paths to avoid cache permission issues
  try {
    app.setPath('userData', userDataPath);
    app.setPath('cache', cachePath);
    app.setPath('temp', tempPath);
    console.info('App paths set successfully');
  } catch (pathErr) {
    console.warn('Could not set app paths:', pathErr.message);
  }

  startProxyServer();
  createWindow().catch(err => {
    console.error('Failed to create window:', err);
  });
});

app.on('before-quit', () => {
  tray && tray.destroy();

  // Stop embedded proxy server
  if (global.proxyServer) {
    console.info('Stopping embedded proxy server...');
    global.proxyServer.close();
    global.proxyServer = null;
  }

  // Stop external proxy process (fallback)
  if (proxyProcess && !proxyProcess.killed) {
    console.info('Stopping proxy server process...');
    proxyProcess.kill();
  }
});

app.on('window-all-closed', () => app.quit());

app.on('activate', () => window === null && createWindow());

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    if (window) {
      showWindow();
      window.focus();
    }
  });
}

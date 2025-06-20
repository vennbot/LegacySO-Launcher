const path = require('path');
const os = require('os');
const packageJson = require('../package.json');

// Override console.log to replace undefined with "Reticulating splines..."
const originalConsoleLog = console.log;
console.log = function() {
    const args = Array.from(arguments).map(arg => {
        if (arg === undefined || (typeof arg === 'string' && arg.includes('undefined'))) {
            return "Reticulating splines...";
        }
        return arg;
    });
    originalConsoleLog.apply(console, args);
};

// Define base paths
const homeDir = os.homedir();
const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share');
const linuxLibPath = process.platform === 'linux' ? '/usr/lib/x86_64-linux-gnu' : '';
const isTestMode = process.argv.indexOf('--fl-test-mode') !== -1;
const fileLogEnabled = process.argv.indexOf('--fl-filelog') !== -1;
const devToolsEnabled = process.argv.indexOf('--fl-devtools') !== -1;
const version = packageJson.version;
const defaultRefreshRate = 60;
const defaultGameLanguage = 'English';

const dependencies = {
  'lSO': ['lSO', ...(['darwin', 'linux'].includes(process.platform) ? ['Mono', 'SDL'] : ['OpenAL'])],
  'RMS': ['LSO'],
  'MacExtras': ['LSO'],
  'Simitone': (['darwin', 'linux'].includes(process.platform)) ? ['Mono', 'SDL'] : []
};

const needInternet = [
  'TSO',
  'lSO',
  'RMS',
  'Simitone',
  'Mono',
  'MacExtras',
  'SDL'
];

const darkThemes = [
  'halloween', 'dark', 'indigo'
];

const components = {
  'TSO': 'The Sims Online',
  'LSO': 'LegacySO',
  'OpenAL': 'OpenAL',
  'NET': '.NET Framework',
  'RMS': 'Remesh Package',
  'Simitone': 'Simitone for Windows',
  'Mono': 'Mono Runtime',
  'MacExtras': 'FreeSO MacExtras',
  'SDL': 'SDL2'
};

const versionChecks = {
  remeshPackageUrl: 'https://lso-meshes.vennbot-lso.workers.dev/?mode=versiontext',
  updatesUrl: 'https://lso-launcher.vennbot-lso.workers.dev',
  interval: 5 * 60 * 1000 // every 5 minutes
};

const links = {
  updateWizardUrl: 'https://lso-launcher.vennbot-lso.workers.dev',
  repoNewIssueUrl: 'https://github.com/vennbot/LegacySO-Launcher/issues/new/choose',
  repoViewIssuesUrl: 'https://github.com/vennbot/LegacySO-Launcher/issues',
  repoDocsUrl: 'https://github.com/vennbot/LegacySO-Launcher/wiki',
  repoUrl: 'https://github.com/vennbot/LegacySO-Launcher'
};

const releases = {
  simitoneUrl: 'https://api.github.com/repos/riperiperi/Simitone/releases/latest',
  fsoGithubUrl: 'https://lso-builds.vennbot-lso.workers.dev/',
  fsoApiUrl: 'https://api.legacyso.org'
};

const resourceCentral = {
  'TheSimsOnline': 'https://api.legacyso.org/tso',
  'FreeSO': 'https://beta.freeso.org/LauncherResourceCentral/FreeSO',
  'LegacySO': 'https://lso-builds.vennbot-lso.workers.dev/',
  'OpenAL': 'https://openal.org/downloads/oalinst.exe',
  '3DModels': 'https://lso-meshes.vennbot-lso.workers.dev/',
  'Mono': 'https://beta.freeso.org/LauncherResourceCentral/Mono',
  'MacExtras': 'https://api.legacyso.org/MacExtras',
  'SDL': 'https://beta.freeso.org/LauncherResourceCentral/SDL',
  'WS': 'https://beta.freeso.org/LauncherResourceCentral/ws',
  'TrendingLots': 'http://localhost:30632/trending-lots',
  'Scenarios': 'https://beta.freeso.org/LauncherResourceCentral/Scenarios',
  'Blog': 'http://localhost:30632/blog',
  'NET': 'https://download.microsoft.com/download/C/3/A/C3A5200B-D33C-47E9-9D70-2F7C65DAAD94/NDP46-KB3045557-x86-x64-AllOS-ENU.exe'
};

const temp = {
  'LSO': `${appData}/temp/artifacts-legacyso-%s.zip`,  // Make sure this matches what's used in the installer
  'FSO': `${appData}/temp/artifacts-freeso-%s.zip`,
  'MacExtras': `${appData}/temp/macextras-%s.zip`,
  'Mono': `${appData}/temp/mono-%s.pkg`,
  'RMS': `${appData}/temp/artifacts-remeshes-%s.zip`,
  'SDL': `${appData}/temp/sdl2-%s.dmg`,
  'TSO': {
    path: `${appData}/temp/tsoclient`,
    file: 'client.zip',
    extractionFolder: 'client',
    firstCab: 'TSO_Installer_v1.1239.1.0/Data1.cab',
    rootCab: 'Data1.cab'
  }
};

const registry = {
  ociName: 'LegacySO Game',
  paths: {
    'TSO': process.platform === 'win32' ?
      'HKLM\\SOFTWARE\\Maxis\\The Sims Online' :
      `${appData}/GameComponents/The Sims Online/TSOClient/TSOClient.exe`,
    'LSO': process.platform === 'win32' ?
      'HKLM\\SOFTWARE\\Rhys Simpson\\LegacySO' :
      path.join(appData, 'GameComponents', 'LegacySO', 'LegacySO.exe'),
    'OpenAL': 'HKLM\\SOFTWARE\\OpenAL',
    'NET': 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP',
    'Mono': process.platform === 'darwin' ? '/Library/Frameworks/Mono.framework' : '/usr/bin/mono',
    'SDL': process.platform === 'darwin' ? '/Library/Frameworks/SDL2.framework' : `${linuxLibPath}/libSDL2-2.0.so.0`
  },
  fallbacks: process.platform === 'win32' ? {
    'TSO': [
      'C:/Program Files/Maxis/The Sims Online/TSOClient/TSOClient.exe',
      'C:/Program Files/The Sims Online/TSOClient/TSOClient.exe',
      'C:/Program Files/LegacySO Game/The Sims Online/TSOClient/TSOClient.exe'
    ],
    'LSO': [
      path.join('C:', 'Program Files', 'LegacySO Game', 'LegacySO', 'LegacySO.exe'),
      path.join('C:', 'Program Files', 'LegacySO', 'LegacySOClient', 'LegacySO.exe')
    ],
    'OpenAL': [
      'C:/Program Files (x86)/OpenAL'
    ]
  } : {
    'TSO': [
      `${appData}/GameComponents/The Sims Online/TSOClient/TSOClient.exe`,
      `${homeDir}/Documents/The Sims Online/TSOClient/TSOClient.exe`,
    ],
    'LSO': [
      path.join(appData, 'GameComponents', 'LegacySO', 'LegacySO.exe'),
      path.join(homeDir, 'Documents', 'LegacySO', 'LegacySO.exe'),
    ]
  }
};

const gameLanguages = {
    English: 0,
    French: 3,
    German: 4,
    Italian: 5,
    Spanish: 6,
    Dutch: 7,
    Danish: 8,
    Swedish: 9,
    Norwegian: 10,
    Finnish: 11,
    Hebrew: 12,
    Russian: 13,
    Portuguese: 14,
    Japanese: 15,
    Polish: 16,
    SimplifiedChinese: 17,
    TraditionalChinese: 18,
    Thai: 19,
    Korean: 20,
    Slovak: 21
};

module.exports = {
  path,  // Export path module
  homeDir,
  appData,
  isTestMode,
  fileLogEnabled,
  devToolsEnabled,
  version,
  defaultRefreshRate,
  defaultGameLanguage,
  dependencies,
  needInternet,
  darkThemes,
  components,
  versionChecks,
  links,
  releases,
  resourceCentral,
  temp,
  registry,
  gameLanguages
};






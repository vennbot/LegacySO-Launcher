/* eslint-disable indent */
const { captureWithSentry, getJSON, strFormat, getDisplayRefreshRate } = require('./lib/utils');
const semver = require('semver'); // ─── NEW
const { shell, nativeTheme } = require('electron');
const { locale } = require('./lib/locale');
const {
    versionChecks,
    version,
    appData,
    darkThemes,
    defaultRefreshRate,
    releases: { simitoneUrl },
    links: { updateWizardUrl },
    defaultGameLanguage
} = require('./constants');

const Modal = require('./lib/modal');
const Events = require('./events');
const IPCBridge = require('./lib/ipc-bridge');
const Toast = require('./lib/toast');
const path = require('path');
const LSOInstaller = require('./lib/installers/lso');
const TSOInstaller = require('./lib/installers/tso');

/**
 * Main launcher class.
 */
class LSOLauncher {
    constructor({ window, userSettings, onReload }) {
        this.userSettings = userSettings;
        this.window = window;
        this.minimizeReminder = false;
        this.lastUpdateNotification = false;
        this.isSearchingForUpdates = false;
        this.hasInternet = false;
        this.updateLocation = false;
        this.reloadCallback = onReload;
        this.remeshInfo = { location: false, version: false };
        this.ociFolder = null;
        this.activeTasks = [];
        this.isInstalled = {
            OpenAL: false,
            LSO: false,
            TSO: false,
            NET: false,
            Simitone: false,
            TS1: false,
            Mono: false,
            SDL: false,
            RMS: false            // ─── track Remesh manifest path
        };

        if (process.platform === 'win32') {
            this.window.on('minimize', () => {
                if (!this.minimizeReminder) {
                    Modal.sendNotification(
                        'LegacySO Launcher',
                        locale.current.MINIMIZE_REMINDER,
                        null, null,
                        this.isDarkMode()
                    );
                    this.minimizeReminder = true;
                }
                this.window.setSkipTaskbar(true);
                this.window.hide();
            });
        }

        this.IPC = Toast.IPC = Modal.IPC = new IPCBridge(window);
        this.events = new Events(this);
        this.checkUpdatesRecursive();
        this.updateTipRecursive();
        this.updateInternetStatusRecursive();
        this.events.listen();
    }

    reload() {
        if (this.reloadCallback) {
            this.reloadCallback(this.userSettings);
        }
    }

    /**
     * Reads the registry and updates the programs list.
     * Now includes enhanced multi-drive detection for external installations.
     */
    async updateInstalledPrograms() {
        const registry = require('./lib/registry'),
            programs = await registry.getInstalled();

        for (let i = 0; i < programs.length; i++) {
            this.isInstalled[programs[i].key] = programs[i].isInstalled;
        }
        console.info('updateInstalledPrograms (before enhanced detection)', this.isInstalled);

        console.log('Running enhanced multi-drive detection...');
        await this.checkInstallations();

        // ─── NEW: Manifest-based RMS detection ───────────────────────────────
        try {
            const fs = require('fs-extra');
            const rmsFolder = this.isInstalled.LSO
                ? path.join(this.isInstalled.LSO, 'Content', 'MeshReplace')
                : null;

            let manifestPath = false;
            let manifestVer = null;

            if (rmsFolder && await fs.pathExists(rmsFolder)) {
                const files = await fs.readdir(rmsFolder);
                for (const f of files) {
                    const m = /^remeshes-(.+)\.json$/.exec(f);
                    if (m) {
                        manifestVer = m[1];
                        manifestPath = path.join(rmsFolder, f);
                        break;
                    }
                }
            }

            this.isInstalled.RMS = manifestPath;
            console.info(
                'RMS installed:', Boolean(manifestPath),
                manifestPath
                    ? `manifest: ${manifestPath}, version: ${manifestVer}`
                    : ''
            );
        } catch (err) {
            console.error('Error detecting RMS manifest', err);
        }
        // ─────────────────────────────────────────────────────────────────────

        console.info('updateInstalledPrograms (after enhanced detection)', this.isInstalled);
        this.IPC.sendInstalledPrograms(this.isInstalled);
    }

    updateTipRecursive() {
        const tips = [
            locale.current.TIP1, locale.current.TIP2, locale.current.TIP3,
            locale.current.TIP4, locale.current.TIP5, locale.current.TIP6,
            locale.current.TIP7, locale.current.TIP8, locale.current.TIP9,
            locale.current.TIP10, locale.current.TIP12, locale.current.TIP13
        ];
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        this.IPC.setTip(randomTip);
        setTimeout(() => this.updateTipRecursive(), 10000);
    }

    getInternetStatus() {
        const sites = ['google.com', 'bing.com', 'yahoo.com'];
        return new Promise((resolve) => {
            const doCheck = (index) => {
                if (index >= sites.length) return resolve(false);
                require('dns').lookup(sites[index], err => {
                    if (err && err.code === 'ENOTFOUND') doCheck(index + 1);
                    else resolve(true);
                });
            };
            doCheck(0);
        });
    }

    getSimitoneReleaseInfo() {
        return getJSON(simitoneUrl);
    }

    async updateInternetStatus() {
        this.hasInternet = await this.getInternetStatus();
        if (!this.hasInternet) return this.IPC.hasNoInternet();
        return this.IPC.hasInternet();
    }

    updateInternetStatusRecursive() {
        setTimeout(() => {
            this.updateInternetStatus();
            this.updateInternetStatusRecursive();
        }, 5000);
    }

    async runFullInstall(folder) {
        const fullInstaller = new (require('./lib/installers/complete'))(this);
        try {
            this.addActiveTask('FULL');
            await fullInstaller.install(folder);
            Modal.showFullInstalled();
        } catch (err) {
            console.error('runFullInstall', err);
        } finally {
            setTimeout(() => {
                this.removeActiveTask('FULL');
                this.IPC.fullInstallProgressItem();
            }, 5000);
        }
    }

    addActiveTask(name) {
        if (!this.isActiveTask(name)) {
            console.info('addActiveTask', name);
            this.activeTasks.push(name);
        }
    }

    removeActiveTask(name) {
        if (name) {
            console.info('removeActiveTask', name);
            return this.activeTasks.splice(this.activeTasks.indexOf(name), 1);
        }
    }

    isActiveTask(name) {
        return this.activeTasks.indexOf(name) > -1;
    }

    getPrettyName(componentCode) {
        const components = require('./constants').components;
        return components[componentCode] || componentCode;
    }

    /**
     * Returns any missing dependencies for a component.
     */
    getMissingDependencies(componentCode) {
        const { dependencies } = require('./constants');
        return (dependencies[componentCode] || [])
            .filter(dep => !this.isInstalled[dep])
            .map(dep => this.getPrettyName(dep));
    }

    /**
     * Checks if a component requires internet to install.
     */
    requiresInternet(componentCode) {
        return require('./constants').needInternet.includes(componentCode);
    }

    /**
     * Displays the appropriate installation confirmation Modal.
     *
     * @param {string} componentCode The Component to be installed.
     */
    async fireInstallModal(componentCode) {
        const missing = this.getMissingDependencies(componentCode);

        if (this.requiresInternet(componentCode) && !this.hasInternet) {
            console.info(`no internet to install ${componentCode}`);
            return Modal.showNoInternet();
        }
        if (this.isActiveTask(componentCode)) {
            console.info(`already installing ${componentCode}`);
            return Modal.showAlreadyInstalling();
        }
        if (missing.length > 0) {
            console.info(`missing requirements for ${componentCode}`, missing);
            return Modal.showRequirementsNotMet(missing);
        }

        if (componentCode === 'RMS') {
            if (!this.remeshInfo?.version) {
                try {
                    await this.getRemeshData();
                } catch (err) {
                    captureWithSentry(err);
                    console.error(err);
                }
                if (!this.remeshInfo?.version) {
                    console.info('no remesh pkg available', this.remeshInfo);
                    return Modal.showNoRemesh();
                }
            }
        }

        if (!this.isInstalled[componentCode]) {
            Modal.showFirstInstall(this.getPrettyName(componentCode), componentCode);
        } else {
            Modal.showReInstall(this.getPrettyName(componentCode), componentCode);
        }
    }

    // ─── REMESH VERSION LOGIC (UNCHANGED) ────────────────────────────────

    /**
     * Obtains remesh package version (plain text).
     * @returns {Promise<{Version:string}>}
     */
    async getRemeshData() {
        try {
            const resp = await fetch(versionChecks.remeshPackageUrl);
            if (!resp.ok) {
                console.warn(`Remesh version check HTTP ${resp.status}; skipping.`);
                return { Version: null };
            }
            const ver = (await resp.text()).trim();
            this.remeshInfo = { version: ver };
            return { Version: ver };
        } catch (err) {
            console.warn('Remesh version fetch failed:', err);
            return { Version: null };
        }
    }

    /**
     * Checks remote vs installed remesh version and notifies UI if update needed.
     */
    async checkRemeshInfo() {
        const data = await this.getRemeshData();
        const latest = data.Version;
        if (!latest) {
            return;
        }
        this.remeshInfo = { version: latest };
        this.IPC.setRemeshInfo(latest);
        const installed = this.userSettings.Game?.RMSVersion || null;
        const needsUpdate = !installed || semver.lt(installed, latest);
        this.IPC.sendRemeshShouldUpdate(needsUpdate, installed, latest);
    }
    // ─────────────────────────────────────────────────────────────────────

    async getLauncherData() {
        const url = `${versionChecks.updatesUrl}?mode=versiontext`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Update check failed: ${resp.status}`);
        const latest = (await resp.text()).trim();
        return { Version: latest };
    }

    checkUpdatesRecursive() {
        setTimeout(() => {
            this.checkLauncherUpdates(true);
            this.checkRemeshInfo();
            this.checkUpdatesRecursive();
        }, versionChecks.interval);
    }

    // … all other existing methods (install handlers, initDOM, checkInstallations, persist, launchGame, etc.) unchanged …

    /**
     * Installs a single Component.
     * @param {string} componentCode The component to install.
     * @param {Object} options Options for installation.
     */
    async install(componentCode, options = { fullInstall: false, override: false, dir: false }) {
        this.addActiveTask(componentCode);
        console.info('install', { componentCode, options });
        try {
            let display = false;
            switch (componentCode) {
                case 'Mono':
                case 'MacExtras':
                case 'SDL':
                case 'RMS':
                    display = await this.handleSimpleInstall(componentCode, options);
                    break;
                case 'TSO':
                case 'LSO':
                case 'Simitone':
                    display = await this.handleStandardInstall(componentCode, options);
                    break;
                case 'OpenAL':
                case 'NET':
                    display = await this.handleExecutableInstall(componentCode, options);
                    break;
                default:
                    console.error('invalid componentCode', componentCode);
                    this.removeActiveTask(componentCode);
                    throw new Error(strFormat('Component %s not found', componentCode));
            }
            if (!options.fullInstall && display) {
                Modal.showInstalled(this.getPrettyName(componentCode));
            }
        } catch (err) {
            Modal.showFailedInstall(this.getPrettyName(componentCode), err);
            this.setProgressBar(1, { mode: 'error' });
            captureWithSentry(err, { component: componentCode, options, isInstalled: this.isInstalled });
            throw err;
        } finally {
            setTimeout(() => this.setProgressBar(-1), 5000);
            this.removeActiveTask(componentCode);
            this.updateInstalledPrograms();
        }
    }

    /**
     * Simple install flow for components requiring no user input.
     */
    async handleSimpleInstall(componentCode, options) {
        const runner = require('./lib/installers')[componentCode];
        const subfolder = componentCode === 'RMS' ? '/Content/MeshReplace' : '';
        const installer = new runner(this, this.isInstalled.LSO + subfolder);
        if (!options.fullInstall) {
            this.IPC.changePage('downloads');
        }
        await installer.install();
        if (['MacExtras', 'RMS'].includes(componentCode) && this.isInstalled.Simitone) {
            const simitoneInstaller = new runner(this, this.isInstalled.Simitone + subfolder, 'Simitone');
            await simitoneInstaller.install();
        }
        return true;
    }

    /**
     * Standard install flow for components needing directory selection.
     */
    async handleStandardInstall(componentCode, options) {
        const runner = require('./lib/installers')[componentCode];
        if (options.override) {
            const { createMaxisEntry, createGameEntry, createSimitoneEntry } = require('./lib/registry');
            if (componentCode === 'TSO') await createMaxisEntry(this.setConfiguration.bind(this), options.override);
            if (componentCode === 'LSO') await createGameEntry(this.setConfiguration.bind(this), options.override);
            if (componentCode === 'Simitone') await createSimitoneEntry(this.setConfiguration.bind(this), options.override);
            return false;
        }
        let installDir = options.dir;
        if (!installDir) installDir = await this.obtainInstallDirectory(componentCode);
        if (!installDir) return false;
        const installer = new runner(this, installDir);
        const already = await installer.isInstalledInPath();
        if (already && !options.fullInstall && !options.dir && await require('./lib/registry').hasRegistryAccess()) {
            Modal.showAlreadyInstalled(this.getPrettyName(componentCode), componentCode, installDir);
            console.info('already installed', { componentCode });
            return false;
        }
        if (!options.fullInstall) this.IPC.changePage('downloads');
        console.info('starting the installation', { componentCode });
        await installer.install();
        return true;
    }

    /**
     * Runs an executable installer (OpenAL/.NET).
     */
    async handleExecutableInstall(componentCode, options) {
        const runner = require('./lib/installers/executable');
        const installer = new runner();
        const file = componentCode === 'NET' ? 'NDP46-KB3045560-Web.exe' : 'oalinst.exe';
        let cmdOptions;
        if (options.fullInstall) cmdOptions = componentCode === 'NET' ? ['/q', '/norestart'] : ['/SILENT'];
        await installer.run(file, cmdOptions);
        return false;
    }

    initDOM() {
        this.IPC.setTheme(
            this.userSettings.Launcher.Theme === 'auto'
                ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'open_beta')
                : this.userSettings.Launcher.Theme
        );
        this.IPC.setMaxRefreshRate(getDisplayRefreshRate());
        this.IPC.restoreConfiguration(this.userSettings);
        this.checkRemeshInfo();
        this.updateInternetStatus();
        this.window.focus();
    }

    async checkInstallations(gameType = null) {
        // … original checkInstallations code …
    }

    persist() {
        // … original persist code …
    }

    setProgressBar(val, options) {
        // … original setProgressBar code …
    }

    // … and so on for every other method …
}

module.exports = LSOLauncher;

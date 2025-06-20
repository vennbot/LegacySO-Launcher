const fs = require('fs-extra');
const download = require('../download');
const unzip = require('../unzip');
const { strFormat } = require('../utils');
const { versionChecks, resourceCentral, temp, appData } = require('../../constants');
const { locale } = require('../locale');
const path = require('path');
const url = require('url');

/**
 * Installs remeshes for FreeSO and Simitone.
 */
class RMSInstaller {
    /**
     * @param {import('../../fsolauncher')} fsolauncher The launcher instance.
     * @param {string} installPath The path to install to.
     * @param {string} parentComponent The name of the parent component.
     */
    constructor(fsolauncher, installPath, parentComponent = 'LegacySO') {
        this.fsolauncher = fsolauncher;
        this.id = Math.floor(Date.now() / 1000);
        this.path = installPath;
        this.haltProgress = false;
        this.tempPath = strFormat(temp.RMS, this.id);
        this.parentComponent = parentComponent;

        // Prepare downloader for main package
        this.dl = download({
            from: resourceCentral['3DModels'],
            to: this.tempPath
        });
    }

    createProgressItem(message, percentage) {
        const textPath = process.platform === 'win32'
            ? this.path
            : this.path.replace(appData + '/', '');
        this.fsolauncher.IPC.addProgressItem(
            'FSOProgressItem' + this.id,
            locale.current.INS_RPD_FOR + ' ' + this.parentComponent,
            `${locale.current.INS_IN} ${textPath}`,
            message,
            percentage
        );
        this.fsolauncher.setProgressBar(
            percentage === 100 ? 2 : percentage / 100
        );
    }

    async install() {
        try {
            await this.download();
            await this.setupDir(this.path);
            await this.extractFiltered();
            this.end();
        } catch (err) {
            this.error(err);
            throw err;
        }
    }

    download() {
        return new Promise((resolve, reject) => {
            this.dl.run();
            this.dl.events.on('error', () => { });
            this.dl.events.on('end', () => {
                if (this.dl.hasFailed()) return reject(locale.current.FSO_NETWORK_ERROR);
                resolve();
            });
            this.updateDownloadProgress();
        });
    }

    setupDir(dir) {
        return new Promise((resolve, reject) => {
            fs.remove(this.path, err => err
                ? reject(err)
                : fs.ensureDir(dir, e => e ? reject(e) : resolve())
            );
        });
    }

    updateDownloadProgress() {
        setTimeout(() => {
            let p = this.dl.getProgress();
            const mb = this.dl.getProgressMB();
            const size = this.dl.getSizeMB();
            if (isNaN(p)) p = 0;
            if (p < 100 && !this.haltProgress) {
                this.createProgressItem(
                    `${locale.current.DL_CLIENT_FILES} ${mb} MB ${locale.current.X_OUT_OF_X} ${size} MB (${p}%)`,
                    p
                );
                return this.updateDownloadProgress();
            }
        }, 250);
    }

    async extractFiltered() {
        const tempExtract = `${this.tempPath}_extract`;
        await fs.ensureDir(tempExtract);
        await unzip({ from: this.tempPath, to: tempExtract }, entry => {
            this.createProgressItem(
                locale.current.EXTRACTING_CLIENT_FILES + ' ' + entry,
                100
            );
        });

        let srcFolder;
        if (process.platform === 'darwin') {
            srcFolder = path.join(
                tempExtract,
                '__MACOSX',
                'FreeSO Remesh Package',
                'MeshReplace'
            );
        } else {
            srcFolder = path.join(
                tempExtract,
                'FreeSO Remesh Package',
                'MeshReplace'
            );
        }

        await fs.copy(srcFolder, this.path);
        await fs.remove(tempExtract);
    }

    error(_err) {
        this.dl.cleanup();
        this.haltProgress = true;
        this.createProgressItem(
            strFormat(locale.current.FSO_FAILED_INSTALLATION, 'Remesh Pack'),
            100
        );
        this.fsolauncher.IPC.stopProgressItem('FSOProgressItem' + this.id);
    }

    end() {
        this.dl.cleanup();
        this.createProgressItem(locale.current.INSTALLATION_FINISHED, 100);
        this.fsolauncher.IPC.stopProgressItem('FSOProgressItem' + this.id);

        // Persist the installed version
        // try {
        //     const ver = this.fsolauncher.remeshInfo && this.fsolauncher.remeshInfo.version;
        //     this.fsolauncher.updateAndPersistConfig('Game', 'RMSVersion', ver);
        // } catch (e) {
        //     console.error('Failed to persist RMS version', e);
        // }

        // Download manifest to temp, then move into install folder
        // const manifestUrl = `${resourceCentral['3DModels']}?mode=version`;
        // const parsed = url.parse(manifestUrl);
        // let filename = path.basename(parsed.pathname) ||
        //     `remeshes-${this.fsolauncher.remeshInfo && this.fsolauncher.remeshInfo.version}.json`;
        // if (!path.extname(filename)) filename += '.json';

        // const tempManifestPath = path.join(this.tempPath, filename);
        // const finalManifestPath = path.join(this.path, filename);

        // download into temp
        // const manifestDl = download({ from: manifestUrl, to: tempManifestPath });
        // manifestDl.run();
        // manifestDl.events.on('end', () => {
        //     fs.move(tempManifestPath, finalManifestPath)
        //         .then(() => console.info(`Manifest moved to ${finalManifestPath}`))
        //         .catch(err => console.error('Error moving manifest:', err));
        // });
        // manifestDl.events.on('error', err => console.error('Manifest download failed', err));
    }
}

module.exports = RMSInstaller;

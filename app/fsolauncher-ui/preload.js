// preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');
const { net } = require('electron');

contextBridge.exposeInMainWorld('shared', {
    // Generic helpers
    on: (event, callback) => ipcRenderer.on(event, callback),
    send: (event, ...data) => ipcRenderer.send(event, ...data),
    openExternal: url => shell.openExternal(url),

    // CORS-free fetch via Electron’s net module
    fetchNoCors: async url => {
        return new Promise((resolve, reject) => {
            const request = net.request(url);
            request.on('response', response => {
                let data = '';
                response.on('data', chunk => { data += chunk; });
                response.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve({
                            ok: response.statusCode >= 200 && response.statusCode < 300,
                            status: response.statusCode,
                            json: () => Promise.resolve(jsonData)
                        });
                    } catch (err) {
                        reject(new Error('Failed to parse JSON: ' + err.message));
                    }
                });
            });
            request.on('error', reject);
            request.end();
        });
    },

    // ─────────── REMESH HELPERS ───────────

    /**
     * Listen for the latest Remesh version (just the version string).
     * Fired whenever the main process gets a REMESH_INFO message.
     *
     * @param {function(string)} callback
     */
    onRemeshInfo: callback => {
        ipcRenderer.on('REMESH_INFO', (_evt, version) => callback(version));
    },

    /**
     * Listen for whether a Remesh update is needed.
     * Fired whenever the main process sends REMESH_SHOULD_UPDATE.
     *
     * @param {function(boolean, string|null, string)} callback
     *        callback(needsUpdate, installedVersion, latestVersion)
     */
    onRemeshShouldUpdate: callback => {
        ipcRenderer.on(
            'REMESH_SHOULD_UPDATE',
            (_evt, needsUpdate, installedVersion, latestVersion) =>
                callback(needsUpdate, installedVersion, latestVersion)
        );
    }
});

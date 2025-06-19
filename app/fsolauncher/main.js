const { ipcMain } = require('electron');
const Modal = require('./lib/modal');

// Remove these event listeners:
// ipcMain.on('UNINSTALL', () => {
//   Modal.showUninstallSelection();
// });

// ipcMain.on('UNINSTALL_SELECTION_CONFIRM', (event, selectedComponents) => {
//   try {
//     const uninstaller = new Uninstaller(mainWindow, config);
//     uninstaller.uninstall(selectedComponents);
//   } catch (error) {
//     event.sender.send('TOAST', `Uninstall error: ${error.message}`, 'error');
//   }
// });






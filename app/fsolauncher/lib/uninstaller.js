const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { isWindows } = require('./utils');
const { registry } = require('../../constants');

class Uninstaller {
  constructor(mainWindow, config) {
    this.mainWindow = mainWindow;
    this.config = config;
  }

  createProgressItem(message, percentage) {
    this.mainWindow.webContents.send('CREATE_PROGRESS_ITEM',
      null,
      'uninstall-progress',
      'Uninstalling',
      message,
      message,
      percentage
    );
  }

  async uninstall(selectedComponents) {
    try {
      this.createProgressItem('Starting uninstall...', 0);
      
      let progress = 0;
      const increment = 100 / selectedComponents.length;

      for (const component of selectedComponents) {
        this.createProgressItem(`Uninstalling ${component}...`, progress);
        await this.uninstallComponent(component);
        progress += increment;
      }

      this.createProgressItem('Uninstall complete', 100);
      this.mainWindow.webContents.send('TOAST', 'Uninstall completed', 'success');
      this.mainWindow.webContents.send('STOP_PROGRESS_ITEM', 'uninstall-progress');
      this.mainWindow.webContents.send('CHANGE_PAGE', 'installer');
    } catch (error) {
      console.error('Uninstall error:', error);
      this.mainWindow.webContents.send('TOAST', `Uninstall error: ${error.message}`, 'error');
      this.mainWindow.webContents.send('STOP_PROGRESS_ITEM', 'uninstall-progress');
    }
  }

  async uninstallComponent(componentId) {
    // Add specific uninstall logic for each component
    switch (componentId) {
      case 'LSO':
        await this.uninstallLSO();
        break;
      case 'TSO':
        await this.uninstallTSO();
        break;
      case 'RMS':
        await this.uninstallRemesh();
        break;
      case 'Simitone':
        await this.uninstallSimitone();
        break;
    }
  }

  async uninstallLSO() {
    // Add LSO uninstall logic
  }

  async uninstallTSO() {
    // Add TSO uninstall logic
  }

  async uninstallRemesh() {
    // Add Remesh uninstall logic
  }

  async uninstallSimitone() {
    // Add Simitone uninstall logic
  }
}

module.exports = Uninstaller;


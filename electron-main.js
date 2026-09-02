const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Disable GPU to prevent crash on systems with restricted GPU access
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');

// Catch any uncaught errors and show a dialog so we know what crashed
process.on('uncaughtException', (err) => {
  try { dialog.showErrorBox('Fatal Error', err.message + '\n\n' + err.stack); } catch(e) {}
  app.quit();
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

let mainWindow;
let tray = null;

// Only allow a single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupTray();
    
    try {
        const net = require('net');
        const server = require('./index');

        function startServer() {
          server.listen(3001, () => {
            console.log('WhatIsX backend running on port 3001 inside Electron');
            createWindow();
          }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              // Kill old process on this port and retry
              const killer = net.createConnection({ port: 3001 }, () => { killer.destroy(); });
              killer.on('error', () => {});
              const { execSync } = require('child_process');
              try {
                execSync('for /f "tokens=5" %a in (\'netstat -aon ^| find ":3001 "\') do taskkill /F /PID %a', { shell: 'cmd.exe', stdio: 'ignore' });
              } catch(e) {}
              setTimeout(startServer, 1500);
            } else {
              dialog.showErrorBox('Server Error', err.message);
            }
          });
        }
        startServer();
    } catch(err) {
        dialog.showErrorBox('Initialization Error', err.message + '\n\n' + err.stack);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,  // Don't show until page is loaded
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL('http://localhost:3001');

  // Show window once page content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Fallback: if ready-to-show never fires within 10s, show anyway
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 10000);
  mainWindow.once('ready-to-show', () => clearTimeout(showFallback));

  // If the page fails to load, show a clear error dialog
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // Ignore aborted loads (normal during redirects)
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Page Load Failed',
      message: `Could not load the WhatIsX dashboard.\n\nError: ${errorDescription} (${errorCode})\nURL: ${validatedURL}\n\nThe server may still be starting up. Click Retry to try again.`,
      buttons: ['Retry', 'Quit']
    }).then(({ response }) => {
      if (response === 0) {
        mainWindow.loadURL('http://localhost:3001');
      } else {
        app.quit();
      }
    });
  });

  // Open external links in default browser instead of the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle IPC from custom titlebar
  ipcMain.on('window-minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow.hide(); // Hide to tray instead of quitting immediately
  });
}

function setupTray() {
  // If you add an icon later, path it here
  // tray = new Tray(path.join(__dirname, 'public', 'icon.png'));
  // For now, we'll try to just catch close to keep in background if needed
}

// App close event handler to really quit
ipcMain.on('app-quit', () => {
  app.quit();
});

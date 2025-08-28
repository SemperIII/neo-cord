// electron-handler.js
if (window.require) {
    const { ipcRenderer } = window.require('electron');
    
    // Функции для взаимодействия с Electron
    window.electronAPI = {
        getVersion: () => ipcRenderer.invoke('get-app-version'),
        restartApp: () => ipcRenderer.invoke('restart-app'),
        onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
        
        // Уведомления для системного трея
        showNotification: (title, body) => {
            if (Notification.permission === 'granted') {
                new Notification(title, { body });
            }
        },
        
        // Минимум/максимум окна
        minimizeWindow: () => ipcRenderer.send('window-minimize'),
        maximizeWindow: () => ipcRenderer.send('window-maximize'),
        closeWindow: () => ipcRenderer.send('window-close')
    };
} else {
    // Заглушка для браузерной версии
    window.electronAPI = {
        getVersion: () => Promise.resolve('1.0.0'),
        restartApp: () => console.log('Restart not available in browser'),
        onUpdateAvailable: () => {},
        showNotification: (title, body) => {
            if (Notification.permission === 'granted') {
                new Notification(title, { body });
            }
        },
        minimizeWindow: () => console.log('Minimize not available in browser'),
        maximizeWindow: () => console.log('Maximize not available in browser'),
        closeWindow: () => console.log('Close not available in browser')
    };
}
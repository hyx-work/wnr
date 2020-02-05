const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, dialog, shell, powerSaveBlocker, systemPreferences } = require('electron')
const Store = require('electron-store');
const store = new Store();
const path = require("path");
const notifier = require('node-notifier');
var i18n = require("i18n");
var Registry = require('winreg')

//keep a global reference of the objects, or the window will be closed automatically when the garbage collecting.
let win, settingsWin = null, aboutWin = null, tourWin = null;
let tray = null, contextMenu = null;
let resetAlarm = null, powerSaveBlockerId = null;
let isTimerWin = null, isWorkMode = null;
let timeLeftTip = null;
let predefinedTasks = null

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')//to play sounds

function createWindow() {
    //create the main window
    win = new BrowserWindow({
        width: 364,
        height: 396,
        frame: false,
        backgroundColor: "#FEFEFE",
        resizable: false,
        maximizable: false,
        show: false,
        hasShadow: true,
        webPreferences: { nodeIntegration: true, webgl: false },
        titleBarStyle: "hiddenInset",
        title: "wnr",
        icon: "./res/icons/wnrIcon.png"
    });//optimize for cross platfrom

    //load index.html
    win.loadFile('index.html');

    //to load without sparking
    win.once('ready-to-show', () => {
        win.show();
        //win.webContents.openDevTools()
    });

    //triggers when the main windows is closed
    win.on('closed', () => {
        win = null;
    });

    //triggers for macos lock
    win.on('close', (event) => {
        if (store.get("islocked")) event.preventDefault();
    });

    //triggers for focusing
    win.on('blur', () => {
        if (store.get("fullscreen-protection")) {
            win.focus();
            win.moveTop();
        }
    });

    //prevent app-killers for lock mode / focus mode
    win.webContents.on('crashed', () => {
        if (store.get('islocked') || (store.get('fullscreen-protection') && isTimerWin)) app.relaunch()
    })
}

function alarmSet() {
    if (!resetAlarm) {
        resetAlarm = setInterval(function () {
            if (store.get('alarmtip')) {
                if (win != null) win.flashFrame(true);
                notifier.notify(
                    {
                        title: i18n.__('alarm-for-not-using-wnr-dialog-box-title'),
                        message: i18n.__('alarm-for-not-using-wnr-dialog-box-content'),
                        icon: path.join(__dirname, process.platform == "win32" ? '\\res\\icons\\wnrIcon.png' : '/res/icons/iconMac.png'),
                        sound: true,
                        wait: true //to wait with callback, until user action is taken against notification
                    }, function () {
                        if (win != null) if (!win.isVisible()) win.show();
                    }
                );
            }
        }, 600000)//alarm you for using wnr
    }
}

function setFullScreenMode(flag) {
    if (win != null) {
        if (process.platform == "darwin") win.setKiosk(flag);
        else win.setFullScreen(flag)
    }
}

//before quit
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    tray.destroy();
    tray = null
})

//when created the app, triggers
//some apis can be only used inside ready
app.on('ready', () => {
    createWindow();

    i18n.configure({
        locales: ['en', 'zh'],
        directory: __dirname + '/locales',
        register: global
    });
    if (store.get("i18n") == undefined) {
        var lang = app.getLocale();
        if (lang[0] == 'e' && lang[1] == 'n') {
            lang = 'en';
        }
        if (lang[0] == 'z' && lang[1] == 'h') {
            lang = 'zh';
        }//the tail isn't required
        store.set('i18n', lang);
    }
    i18n.setLocale(store.get("i18n"));//set the locale

    timeLeftTip = i18n.__("time-left");//this will be used in this file frequently

    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock && win != null) {
        dialog.showMessageBox(win, {
            title: i18n.__('more-than-one-wnr-running-dialog-box-title'),
            type: "warning",
            message: i18n.__('more-than-one-wnr-running-dialog-box-content'),
            checkboxLabel: i18n.__('more-than-one-wnr-running-dialog-box-chk'),
            checkboxChecked: true,
        }).then(function (msg) {
            if (msg.checkboxChecked) app.quit();
        });
    }//prevent wnr from running more than one instance

    app.setAppUserModelId("wnr1");//set the appUserModelId to use notification in Windows

    if (store.get("top") == true && win != null) win.setAlwaysOnTop(true);

    if (!store.get('hotkey1')) store.set('hotkey1', 'W');
    if (!store.get('hotkey2')) store.set('hotkey2', 'S');

    globalShortcut.register('CommandOrControl+Shift+Alt+' + store.get('hotkey1'), () => {
        if (!isTimerWin || (isWorkMode && (!store.get('fullscreen-work')) || (!isWorkMode && (!store.get('fullscreen'))))) {
            if (win != null) win.isVisible() ? win.hide() : win.show();
            if (settingsWin != null) settingsWin.isVisible() ? settingsWin.hide() : settingsWin.show();
            if (aboutWin != null) aboutWin.isVisible() ? aboutWin.hide() : aboutWin.show();
            if (tourWin != null) tourWin.isVisible() ? tourWin.hide() : tourWin.show();
        }//prevent using hotkeys to quit
    })

    if (store.get('islocked')) {//locked mode
        if (process.platform == "win32") win.setSkipTaskbar(true);
        win.closable = false;
    }

    store.set("just-launched", true);
    store.set("fullscreen-protection", false);

    if (process.platform == "darwin") {
        if (!app.isInApplicationsFolder()) {
            notifier.notify(
                {
                    title: i18n.__('wrong-folder-notification-title'),
                    message: i18n.__('wrong-folder-notification-content'),
                    icon: path.join(__dirname, process.platform == "win32" ? '\\res\\icons\\wnrIcon.png' : '/res/icons/iconMac.png'),
                    sound: true
                }
            );
        }
    }

    if (process.platform == "win32") tray = new Tray(path.join(__dirname, '\\res\\icons\\iconWin.ico'));
    else if (process.platform == "darwin") tray = new Tray(path.join(__dirname, '/res/icons/trayIconMacTemplate.png'));
    if (tray != null) tray.setToolTip('wnr');
    traySolution(false);
    macOSFullscreenSolution(false);
    isDarkMode();

    if (!store.has("predefined-tasks-created")) {
        store.set("predefined-tasks-created", true);
        predefinedTasks = new Array({
            name: "wnr recommended",
            workTime: 30,
            restTime: 6,
            loops: 4,
            focusWhenWorking: false,
            focusWhenResting: true
        }, {
            name: "pomodoro",
            workTime: 25,
            restTime: 5,
            loops: 4,
            focusWhenWorking: false,
            focusWhenResting: true
        }, {
            name: "class time",
            workTime: 40,
            restTime: 10,
            loops: 1,
            focusWhenWorking: true,
            focusWhenResting: false
        });
        store.set("predefined-tasks", predefinedTasks);
        store.set("default-task", 0);//0 -> wnr recommended
    } else predefinedTasks = store.get("predefined-tasks", predefinedTasks);//init predefined tasks
    if (store.get("worktime")) {
        predefinedTasks.push({
            name: "user default",
            workTime: store.get("worktime"),
            restTime: store.get("resttime"),
            loops: store.get('looptime'),
            focusWhenWorking: store.get("fullscreen-work"),
            focusWhenResting: store.get("fullscreen")
        })
        store.delete("worktime");
        store.delete("resttime");
        store.delete("looptime");
        store.set("predefined-tasks", predefinedTasks);
        store.set("default-task", predefinedTasks.length - 1)//the last is the newest-added
    }//alternated the former default time settings
})

function traySolution(isFullScreen) {
    if (app.isReady()) {
        if (!isFullScreen) {
            if (process.platform == "darwin") {
                if (!store.get("islocked")) app.dock.show();
                else app.dock.hide();
            }
            if (process.platform == "win32" && store.get('islocked') == false) win.setSkipTaskbar(false);
            contextMenu = Menu.buildFromTemplate([{
                label: 'wnr' + i18n.__('v') + require("./package.json").version
            }, {
                type: 'separator'
            }, {
                label: i18n.__('start-or-stop'),
                enabled: false,
                click: function () {
                    if (win != null) win.webContents.send('start-or-stop')
                }
            }, {
                type: 'separator'
            }, {
                enabled: !isTimerWin,
                label: i18n.__('locker'),
                click: function () {
                    locker();
                }
            }, {
                type: 'separator'
            }, {
                label: i18n.__('website'),
                click: function () {
                    shell.openExternal('https://wnr.scris.top/');
                }
            }, {
                label: i18n.__('github'),
                click: function () {
                    shell.openExternal('https://github.com/RoderickQiu/wnr/');
                }
            }, {
                type: 'separator'
            }, {
                label: i18n.__('show-or-hide'), click: () => {
                    if (win != null) win.isVisible() ? win.hide() : win.show();
                    if (settingsWin != null) settingsWin.isVisible() ? settingsWin.hide() : settingsWin.show();
                    if (aboutWin != null) aboutWin.isVisible() ? aboutWin.hide() : aboutWin.show();
                    if (tourWin != null) tourWin.isVisible() ? tourWin.hide() : tourWin.show();
                }
            }, {
                label: i18n.__('exit'),
                enabled: !store.get('islocked'),
                click: () => { windowCloseChk() }
            }
            ]);
            if (tray != null) {
                tray.on('click', () => {
                    if (store.get("fullscreen-protection") == false) {
                        if (win != null) /*win.isVisible() ? win.hide() :*/ win.show();
                        if (settingsWin != null) /*settingsWin.isVisible() ? settingsWin.hide() :*/ settingsWin.show();
                        if (aboutWin != null) /*aboutWin.isVisible() ? aboutWin.hide() :*/ aboutWin.show();
                        if (tourWin != null) /*tourWin.isVisible() ? tourWin.hide() :*/ tourWin.show();
                    }//with problem
                });//tray
                tray.setContextMenu(contextMenu);
            }
        } else {
            if (process.platform == "darwin") app.dock.hide();
            if (process.platform == "win32") win.setSkipTaskbar(true);
            contextMenu = Menu.buildFromTemplate([{
                label: 'wnr' + i18n.__('v') + require("./package.json").version
            }, {
                type: 'separator'
            }, {
                label: i18n.__('start-or-stop'),
                click: function () {
                    if (win != null) win.webContents.send('start-or-stop')
                }
            }]);
            if (tray != null) {
                tray.setContextMenu(contextMenu);
                tray.on('click', () => { ; })
            }
        }
    }
}

function macOSFullscreenSolution(isFullScreen) {
    if (app.isReady()) {
        if (process.platform === 'darwin') {
            if (!isFullScreen)
                var template = [{
                    label: 'wnr',
                    submenu: [{
                        label: i18n.__('quit'),
                        accelerator: 'CmdOrCtrl+Q',
                        enabled: !store.get('islocked'),
                        click: function () {
                            windowCloseChk();
                        }
                    }]
                }, {
                    label: i18n.__('operations'),
                    submenu: [{
                        enabled: (!store.get('islocked')) && (!isTimerWin),
                        label: i18n.__('settings'),
                        click: function () {
                            settings('normal');
                        }
                    }, {
                        enabled: !isTimerWin,
                        label: i18n.__('locker'),
                        click: function () {
                            locker();
                        }
                    }, {
                        label: i18n.__('tourguide'),
                        enabled: !isTimerWin,
                        click: function () {
                            tourguide();
                        }
                    }, {
                        label: i18n.__('about'),
                        enabled: !isTimerWin,
                        click: function () {
                            about();
                        }
                    }, {
                        type: 'separator'
                    }, {
                        label: i18n.__('website'),
                        click: function () {
                            shell.openExternal('https://wnr.scris.top/');
                        }
                    }, {
                        label: i18n.__('github'),
                        click: function () {
                            shell.openExternal('https://github.com/RoderickQiu/wnr/');
                        }
                    }]
                }];
            else
                var template = [{
                    label: 'wnr',
                    submenu: [{
                        label: i18n.__('quit'),
                        enabled: false
                    }]
                }, {
                    label: i18n.__('operations'),
                    submenu: [{
                        label: i18n.__('settings'),
                        enabled: false
                    }, {
                        label: i18n.__('locker'),
                        enabled: false
                    }, {
                        label: i18n.__('tourguide'),
                        enabled: false
                    }, {
                        label: i18n.__('about'),
                        enabled: false
                    }, {
                        type: 'separator'
                    }, {
                        label: i18n.__('website'),
                        enabled: false
                    }, {
                        label: i18n.__('github'),
                        enabled: false
                    }]
                }];
            var osxMenu = Menu.buildFromTemplate(template);
            Menu.setApplicationMenu(osxMenu)
        }//dock menu for mac os
    }
}

function isDarkMode() {
    if (app.isReady()) {
        store.set('isdark', false);
        if (process.platform == 'darwin') {
            if (systemPreferences.isDarkMode()) {
                store.set('isdark', true);
                if (win != null) win.backgroundColor = '#393939';
            }
            systemPreferences.subscribeNotification(
                'AppleInterfaceThemeChangedNotification',
                function theThemeHasChanged() {
                    isDarkMode();
                    if (win != null) win.webContents.send('darkModeChanges');
                }
            )
        } else if (process.platform == 'win32') {
            var regKey = new Registry({
                hive: Registry.HKCU,
                key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'
            })
            regKey.values(function (err, items) {
                if (err)
                    return 'unset';
                else {
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].name == 'AppsUseLightTheme') {
                            if (items[i].value == "0x0") {
                                store.set('isdark', true);
                                if (win != null) win.backgroundColor = '#393939';
                            }
                        }
                    }
                }
            })
        }
    }
}

app.on('activate', () => {
    if (win === null) {
        createWindow()
    }
})

ipcMain.on('focus-first', function () {
    if (store.get("top") != true && win != null) win.setAlwaysOnTop(true);//always on top when full screen
    if (win != null) setFullScreenMode(true);
    macOSFullscreenSolution(true);
    traySolution(true);
    isWorkMode = true;
    store.set("fullscreen-protection", true);
})

ipcMain.on('warning-giver-workend', function () {
    store.set("fullscreen-protection", false);
    if (win != null) {
        isWorkMode = false;
        win.show();
        win.focus();
        win.center();
        win.flashFrame(true);
        if (store.get("fullscreen") == true) {
            if (store.get("top") != true) win.setAlwaysOnTop(true);//always on top when full screen
            setFullScreenMode(true);
            macOSFullscreenSolution(true);
            traySolution(true);
        } else {
            if (store.get("top") != true) win.setAlwaysOnTop(false);//cancel unnecessary always-on-top
            setFullScreenMode(false);
            macOSFullscreenSolution(false);
            traySolution(false);
        }
        setTimeout(function () {
            dialog.showMessageBox(win, {
                title: i18n.__('work-time-end'),
                type: "warning",
                message: i18n.__('work-time-end-msg'),
            }).then(function (response) {
                if (store.get("fullscreen")) store.set("fullscreen-protection", true);
                win.webContents.send('warning-closed');
            })
        }, 1000)
    }
})

ipcMain.on('warning-giver-restend', function () {
    store.set("fullscreen-protection", false);
    if (win != null) {
        isWorkMode = true;
        if (!win.isVisible()) win.show();
        win.flashFrame(true);
        if (store.get("fullscreen-work") == true) {
            if (store.get("top") != true) win.setAlwaysOnTop(true);//always on top when full screen
            setFullScreenMode(true);
            macOSFullscreenSolution(true);
            traySolution(true);
        } else {
            if (store.get("top") != true) win.setAlwaysOnTop(false);//cancel unnecessary always-on-top
            setFullScreenMode(false);
            macOSFullscreenSolution(false);
            traySolution(false);
        }
        setTimeout(function () {
            dialog.showMessageBox(win, {
                title: i18n.__('rest-time-end'),
                type: "warning",
                message: i18n.__('rest-time-end-msg'),
            }).then(function (response) {
                if (store.get("fullscreen-work")) store.set("fullscreen-protection", true);
                win.webContents.send('warning-closed');
            })
        }, 1000)
    }
})

ipcMain.on('warning-giver-all-task-end', function () {
    store.set("fullscreen-protection", false);
    if (win != null) {
        isTimerWin = false;
        if (!win.isVisible()) win.show();
        win.flashFrame(true);
        if (store.get("fullscreen") == true) {
            if (store.get("top") != true) win.setAlwaysOnTop(false);//cancel unnecessary always-on-top
            setFullScreenMode(false);
            macOSFullscreenSolution(false);
            traySolution(false);
        }
        setTimeout(function () {
            dialog.showMessageBox(win, {
                title: i18n.__('all-task-end'),
                type: "warning",
                message: i18n.__('all-task-end-msg'),
            }).then(function (response) {
                win.loadFile('index.html');//automatically back
            })
        }, 1000)
        alarmSet()
    }
})

ipcMain.on('update-feedback', function (event, message) {
    if (message == "update-available")
        dialog.showMessageBox(settingsWin, {
            title: i18n.__('update'),
            type: "warning",
            message: i18n.__('update-msg'),
            checkboxLabel: i18n.__('update-chk'),
            checkboxChecked: true
        }).then(function (msg) {
            if (msg.checkboxChecked) {
                shell.openExternal("https://github.com/RoderickQiu/wnr/releases/latest");
            }
        })
    else if (message == "no-update")
        dialog.showMessageBox(settingsWin, {
            title: i18n.__('no-update'),
            type: "info",
            message: i18n.__('no-update-msg')
        })
    else
        dialog.showMessageBox(settingsWin, {
            title: i18n.__('update-web-problem'),
            type: "info",
            message: i18n.__('update-web-problem-msg')
        })
})

ipcMain.on('delete-all-data', function () {
    dialog.showMessageBox(settingsWin, {
        title: i18n.__('delete-all-data-dialog-box-title'),
        type: "warning",
        message: i18n.__('delete-all-data-dialog-box-content'),
        checkboxLabel: i18n.__('delete-all-data-dialog-box-chk'),
        checkboxChecked: false
    }).then(function (msg) {
        if (msg.checkboxChecked) {
            store.clear();
            app.relaunch();
            app.quit()
        }
    })
})// unchecked checkboxes still not working in Electron

function windowCloseChk() {
    /*dialog.showMessageBox(win, {
        title: i18n.__('window-close-dialog-box-title'),
        type: "warning",
        message: i18n.__('window-close-dialog-box-content'),
        checkboxLabel: i18n.__('window-close-dialog-box-chk'),
        checkboxChecked: false
    }).then(function (msger) {
        if (msger.checkboxChecked) {*/
    app.quit()
    //}
    //})
}// unchecked checkboxes still not working in Electron
ipcMain.on('window-close-chk', windowCloseChk);

ipcMain.on('relauncher', function () {
    store.set('just-relaunched', true);
    app.relaunch();
    app.exit(0)
})

ipcMain.on('window-hide', function () {
    if (win != null) win.hide()
})

ipcMain.on('window-minimize', function () {
    if (win != null) win.minimize()
})

function about() {
    if (app.isReady()) {
        if (win != null) {
            aboutWin = new BrowserWindow({
                parent: win,
                width: 279,
                height: 256,
                backgroundColor: "#FEFEFE",
                resizable: false,
                frame: false,
                show: false,
                center: true,
                titleBarStyle: "hidden",
                webPreferences: { nodeIntegration: true }
            });
            aboutWin.loadFile("about.html");
            if (store.get("top") == true) aboutWin.setAlwaysOnTop(true);
            aboutWin.once('ready-to-show', () => {
                aboutWin.show();
            })
            aboutWin.on('closed', () => {
                aboutWin = null;
            })
        }
    }
}
ipcMain.on('about', about);

function settings(mode) {
    if (app.isReady()) {
        if (win != null) {
            settingsWin = new BrowserWindow({
                parent: win,
                width: 729,
                height: 486,
                backgroundColor: "#FEFEFE",
                resizable: false,
                frame: false,
                show: false,
                center: true,
                webPreferences: { nodeIntegration: true },
                titleBarStyle: "hidden"
            });
            if (mode == 'locker') settingsWin.loadFile("settings.html", { hash: '#locker-anchor' });
            else if (mode == 'predefined-tasks') settingsWin.loadFile("settings.html", { hash: '#predefined-tasks-anchor' });
            else settingsWin.loadFile("settings.html");
            if (store.get("top") == true) settingsWin.setAlwaysOnTop(true);
            settingsWin.once('ready-to-show', () => {
                settingsWin.show();
            })
            settingsWin.on('closed', () => {
                win.reload();
                settingsWin = null;
            })
            if (!store.get("settings-experience")) {
                store.set("settings-experience", true);
                notifier.notify(
                    {
                        title: i18n.__('newbie-for-settings'),
                        message: i18n.__('newble-for-settings-tip'),
                        icon: path.join(__dirname, process.platform == "win32" ? '\\res\\icons\\wnrIcon.png' : '/res/icons/iconMac.png'),
                        sound: true,
                        wait: true //to wait with callback, until user action is taken against notification
                    }
                );
            }
        }
    }
}
ipcMain.on('settings', settings);

function tourguide() {
    if (app.isReady()) {
        if (win != null) {
            tourWin = new BrowserWindow({
                parent: win,
                width: 729,
                height: 600,
                backgroundColor: "#FEFEFE",
                resizable: false,
                frame: false,
                show: false,
                center: true,
                titleBarStyle: "hidden",
                webPreferences: { nodeIntegration: true }
            });
            tourWin.loadFile("tourguide.html");
            if (store.get("top") == true) tourWin.setAlwaysOnTop(true);
            tourWin.once('ready-to-show', () => {
                tourWin.show();
            })
            tourWin.on('closed', () => {
                tourWin = null;
            })
            notifier.notify(
                {
                    title: i18n.__('welcome-part-1'),
                    message: i18n.__('alarm-for-not-using-wnr-dialog-box-content'),
                    icon: path.join(__dirname, process.platform == "win32" ? '\\res\\icons\\wnrIcon.png' : '/res/icons/iconMac.png'),
                    sound: true
                }
            );
        }
    }
}
ipcMain.on('tourguide', tourguide);


function predefiner() {
    settings('predefined-tasks');
}
ipcMain.on('predefined-tasks', predefiner);

function locker() {
    settings('locker');
}
ipcMain.on('locker', locker);
ipcMain.on('locker-passcode', function (event, message) {
    let lockerMessage = null;
    if (message == "wrong-passcode") lockerMessage = i18n.__('locker-settings-input-tip-wrong-password');
    if (message == "lock-mode-on") lockerMessage = i18n.__('locker-settings-status') + i18n.__('on') + i18n.__('period-symbol');
    if (message == "lock-mode-off") lockerMessage = i18n.__('locker-settings-status') + i18n.__('off') + i18n.__('period-symbol');
    if (message == "not-same-password") lockerMessage = i18n.__('locker-settings-not-same-password');
    if (message == "empty") lockerMessage = i18n.__('locker-settings-empty-password');
    if (settingsWin != null)
        dialog.showMessageBox(settingsWin, {
            title: i18n.__('locker-settings'),
            type: "warning",
            message: lockerMessage
        }).then(function (response) {
            if (message == "lock-mode-on" || message == "lock-mode-off") {
                if (settingsWin != null) settingsWin.close();
                settingsWin = null;
                app.relaunch();
                app.exit()
            }
        })
})

ipcMain.on('push-notification', function (event, message) {
    if (!store.get(message.id)) {
        notifier.notify(
            {
                title: message.title,
                message: message.content,
                icon: path.join(__dirname, process.platform == "win32" ? '\\res\\icons\\wnrIcon.png' : '/res/icons/iconMac.png'),
                sound: true,
                wait: true //to wait with callback, until user action is taken against notification
            }, function () {
                if (message.link != "" && message.link != null) shell.openExternal(message.link);
            }
        );
        store.set(message.id, true);
    }
})

ipcMain.on('only-one-min-left', function () {
    //if (!store.get('fullscreen-protection'))
    notifier.notify(
        {
            title: i18n.__('only-one-min-left'),
            message: i18n.__('only-one-min-left-msg'),
            icon: path.join(__dirname, process.platform == "win32" ? '\\res\\icons\\wnrIcon.png' : '/res/icons/iconMac.png'),
            sound: true
        })
})

ipcMain.on("progress-bar-set", function (event, message) {
    if (win != null) win.setProgressBar(1 - message);
    if (tray != null) tray.setToolTip(message * 100 + timeLeftTip)
})

ipcMain.on("logger", function (event, message) {
    console.log(message)
})

ipcMain.on("timer-win", function (event, message) {
    if (message) {
        if (aboutWin != null) aboutWin.close();
        if (tourWin != null) tourWin.close();
        if (settingsWin != null) settingsWin.close();
        globalShortcut.register('CommandOrControl+Shift+Alt+' + store.get('hotkey2'), () => {
            if (win != null) win.webContents.send('start-or-stop');
        })
        if (resetAlarm) {
            clearTimeout(resetAlarm);
        }
        powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');//prevent wnr to be suspended when timing
        isTimerWin = true;
        traySolution();
        macOSFullscreenSolution();
        if (tray != null) {
            contextMenu.items[2].enabled = true;
        }
    } else {
        if (win != null) win.setProgressBar(-1);
        globalShortcut.unregister('CommandOrControl+Shift+Alt+' + store.get('hotkey2'));
        alarmSet();
        if (powerSaveBlockerId)
            if (powerSaveBlocker.isStarted(powerSaveBlockerId))
                powerSaveBlocker.stop(powerSaveBlockerId);
        isTimerWin = false;
        traySolution();
        macOSFullscreenSolution();
        if (tray != null) {
            tray.setToolTip('wnr');
            contextMenu.items[2].enabled = false
        }
    }
})
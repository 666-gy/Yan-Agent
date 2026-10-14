'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32') throw new Error('Windows installer UI must be built on Windows.');
const root = path.resolve(__dirname, '..');
const framework = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const directory = path.join(root, 'build/setup-ui');
const manifest = path.join(directory, 'app.manifest');
execFileSync(path.join(framework, 'csc.exe'), ['/nologo','/target:winexe','/optimize+','/platform:anycpu',
  `/out:${path.join(directory, 'YanSetupUI.exe')}`, `/win32icon:${path.join(root,'renderer/assets/logo-light.ico')}`, `/win32manifest:${manifest}`,
  '/reference:System.dll','/reference:System.Core.dll','/reference:System.Xaml.dll','/reference:System.Windows.Forms.dll',
  ...['PresentationCore','PresentationFramework','WindowsBase'].map(name => `/reference:${path.join(framework,'WPF',name+'.dll')}`),
  `/resource:${path.join(directory,'SetupWindow.xaml')},SetupWindow.xaml`, `/resource:${path.join(root,'renderer/assets/logo-light.png')},logo.png`,
  path.join(directory,'SetupUI.cs')], {stdio:'inherit',windowsHide:true});
console.log('Built native Yan installer UI: ' + fs.statSync(path.join(directory,'YanSetupUI.exe')).size + ' bytes');

'use strict';

/**
 * What people call apps, when it is not the app's own name ("VS Code" for Visual Studio Code). Per platform, as the
 * same word means a different app on each (Windows and Android get theirs in their own plans).
 */

const APP_ALIASES = {
  mac: {
    'vs code': 'Visual Studio Code', vscode: 'Visual Studio Code', code: 'Visual Studio Code',
    chrome: 'Google Chrome', 'google chrome': 'Google Chrome',
    settings: 'System Settings', 'system preferences': 'System Settings', preferences: 'System Settings',
    word: 'Microsoft Word', excel: 'Microsoft Excel', powerpoint: 'Microsoft PowerPoint', outlook: 'Microsoft Outlook',
    teams: 'Microsoft Teams', files: 'Finder', 'file manager': 'Finder', explorer: 'Finder',
    zoom: 'zoom.us', 'app store': 'App Store', calendar: 'Calendar', music: 'Music',
  },
};

const plain = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\s+/g, ' ').trim().replace(/ app$/, '');

function aliasFor(asked, platform = 'mac') {
  const table = APP_ALIASES[platform] || {};
  const key = plain(asked);
  return Object.hasOwn(table, key) ? table[key] : null;
}

module.exports = { APP_ALIASES, aliasFor };

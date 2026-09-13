'use strict';
const fs = require('node:fs');

function browserOptions(env = process.env, platform = process.platform, exists = fs.existsSync) {
    const configured = env.HORDE_BROWSER_EXECUTABLE || env.HORDE_CHROME_EXECUTABLE;
    const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const executablePath = configured || (platform === 'darwin' && exists(macChrome) ? macChrome : null);
    return { headless: true, ...(executablePath ? { executablePath } : {}) };
}

function browserRuntime() {
    const { chromium } = require(process.env.HORDE_PLAYWRIGHT_MODULE || 'playwright');
    return { chromium, launchOptions: browserOptions() };
}

module.exports = { browserOptions, browserRuntime };

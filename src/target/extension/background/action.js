import browser from 'webextension-polyfill'
import { has } from './links'
import { currentTab } from '~target'

let icon = unescape('%u2713') //✓, glitchy without escape in safari

export async function updateBadge(tabId) {
    let tab
    try {
        tab = Number.isInteger(tabId) ? await browser.tabs.get(tabId) : await currentTab()
    } catch {
        // A tab can disappear between an activation/update event and this call.
        return
    }
    const { url, id } = tab || {}
    if (!url || !Number.isInteger(id)) return

    try {
        await Promise.all([
        browser.action.setBadgeBackgroundColor({tabId: id, color: '#0087EA'}),
        browser.action.setBadgeText({tabId: id, text: has(url) ? icon : ''}),

        ...(typeof browser.action.setBadgeTextColor == 'function' ? [
            browser.action.setBadgeTextColor({tabId: id, color: '#FFFFFF'})
        ] : []),
        ])
    } catch {}
}

export async function open(path) {
    if (!path)
        return browser.action.openPopup()

    const { default_popup } = browser.runtime.getManifest().action

    await browser.action.setPopup({ popup: `${default_popup}#${path}` })
    try {
        await browser.action.openPopup()
    } finally {
        //always restore, even if opening failed
        await browser.action.setPopup({ popup: default_popup })
    }
}

async function onTabsUpdated(id, details = {}) {
    if (details?.status == 'complete')
        await updateBadge(id)
}

async function onTabsActivated({ tabId }) {
    await updateBadge(tabId)
}

export default function() {
    browser.tabs.onUpdated.removeListener(onTabsUpdated)
    browser.tabs.onUpdated.addListener(onTabsUpdated)

    browser.tabs.onActivated.removeListener(onTabsActivated)
    browser.tabs.onActivated.addListener(onTabsActivated)
}

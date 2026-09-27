/*
    Safari 17+ Profiles bug: in a non-default profile extension contexts get an
    ephemeral empty cookie jar → api requests are unauthorized.
    Fix: mirror the profile's live cookies into a DNR rule that sets the Cookie
    header on this instance's own api requests (initiatorDomains = instance uuid).

    Relies on:
    - native message 'profile_id' (SFExtensionProfileKey; absent = default profile)
    - manifest: nativeMessaging + cookies + declarativeNetRequestWithHostAccess,
      both hosts covered by optional_host_permissions (required ones prompt at install)
    - a host grant for both hosts, obtainable only via permissions.request from a
      user gesture → until granted the popup is hidden so the icon click can ask
    - user logged in on the site in this profile; its cookies live in the store
      listing tabs (queries without storeId read the shared persistent-1 instead)
    - url-scoped getAll: apex url reveals parent-domain cookies, api url host-only ones
    - DNR reaches popover/background requests only, never extension pages in tabs/windows
*/

import browser from 'webextension-polyfill'
import { environment } from '~target'
import { API_ENDPOINT_URL } from '~data/constants/app'

const RULE_ID = 100
const getApiHosts = () => {
    const { protocol, hostname } = new URL(API_ENDPOINT_URL)
    const apex = hostname.split('.').slice(-2).join('.')
    return {
        protocol,
        hostname,
        apex,
        origins: { origins: [...new Set([apex, hostname])].map(host => `*://${host}/*`) }
    }
}

async function getSafariProfileId() {
    if (!environment.includes('safari'))
        return null

    try {
        const { profile_id } = await browser.runtime.sendNativeMessage('application.id', { type: 'profile_id' })
        return profile_id || null
    } catch(e) {
        return null
    }
}

//with the grant the icon opens the normal popup, without it the bare click
//lands in ask() — the only user gesture reachable from background
async function updatePopup() {
    if (await browser.permissions.contains(getApiHosts().origins)) {
        browser.action.onClicked.removeListener(ask)
        await browser.action.setPopup({ popup: browser.runtime.getManifest().action.default_popup })
    } else {
        browser.action.onClicked.addListener(ask)
        await browser.action.setPopup({ popup: '' })
    }
}

//mirror the profile cookies into a Cookie header for own api requests
async function updateRules() {
    const { protocol, apex } = getApiHosts()
    //own profile store is the one listing tabs, shared legacy store never does
    const storeId = (await browser.cookies.getAllCookieStores())
        .find(({ tabIds }) => tabIds?.length)?.id
    if (!storeId) return

    //both queries can return the same cookie (e.g. parent-domain ones)
    const cookies = [
        ...await browser.cookies.getAll({ url: `${protocol}//${apex}/`, storeId }),
        ...await browser.cookies.getAll({ url: API_ENDPOINT_URL, storeId })
    ]

    //uuid rotates on reinstall; non-special scheme keeps hostname case, DNR needs lowercase
    const uuid = new URL(browser.runtime.getURL('')).hostname.toLowerCase()
    const header = [...new Set(
        cookies.map(({ name, value }) => `${name}=${value}`)
    )].join('; ')

    //every DNR store touch opens sqlite fds Safari 27 never closes back, exhausting
    //the process fd limit → browser crash; write only when the mirror truly changed
    const state = `${uuid};${header}`
    if ((await browser.storage?.session?.get('cookieMirror'))?.cookieMirror == state) return

    await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID],

        ...(header ? {
            addRules: [{
                id: RULE_ID,
                priority: 1,
                condition: {
                    initiatorDomains: [uuid],
                    urlFilter: '|' + API_ENDPOINT_URL
                },
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: [{
                        header: 'Cookie',
                        operation: 'set',
                        value: header
                    }]
                }
            }]
        } : {})
    })

    await browser.storage?.session?.set({ cookieMirror: state })
}

async function ask() {
    if (!await browser.permissions.request(getApiHosts().origins)) return

    await updatePopup()
    await updateRules()

    browser.action.openPopup().catch(() => {})
}

function refresh() {
    updatePopup().catch(console.error)
    updateRules().catch(console.error)
}

function ping() {
    updateRules().catch(console.error)
}

function onCookieChanged({ cookie }) {
    if (cookie?.domain?.includes(getApiHosts().apex)) ping()
}

//fix cookies in non default Safari profiles (they are broken)
export default async function() {
    if (!browser.cookies || !browser.declarativeNetRequest) return
    if (!await getSafariProfileId()) return

    refresh()

    //only the grant state affects the icon
    for (const event of [browser.permissions?.onAdded, browser.permissions?.onRemoved]) {
        event?.removeListener(refresh)
        event?.addListener(refresh)
    }

    browser.cookies?.onChanged?.removeListener(onCookieChanged)
    browser.cookies?.onChanged?.addListener(onCookieChanged)

    browser.runtime.onMessage.removeListener(ping)
    browser.runtime.onMessage.addListener(ping)
}

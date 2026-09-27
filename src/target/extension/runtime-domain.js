import browser from 'webextension-polyfill'
import normalizeRuntimeOrigin from '~data/modules/runtime-origin'
import { setRuntimeOrigins } from '~data/constants/app'

const enabled = process.env.RUNTIME_DOMAIN_MODE === 'true'
const storageKey = 'raindropRuntimeDomain'
let loading

const apply = value => {
	try {
		const apiOrigin = normalizeRuntimeOrigin(value?.apiOrigin)
		const appOrigin = normalizeRuntimeOrigin(value?.appOrigin)
		setRuntimeOrigins({ apiOrigin, appOrigin })
		return true
	} catch {
		setRuntimeOrigins({ apiOrigin: '', appOrigin: '' })
		return false
	}
}

export function initializeRuntimeDomain() {
	if (!enabled) return Promise.resolve(true)
	if (!loading) {
		loading = browser.storage.sync.get(storageKey)
			.then(values => apply(values[storageKey]))
			.catch(() => apply(null))
	}
	return loading
}

export function openRuntimeDomainSettings() {
	return browser.runtime.openOptionsPage()
}

export function watchRuntimeDomainChanges() {
	if (!enabled) return

	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'sync' || !changes[storageKey]) return
		loading = Promise.resolve(apply(changes[storageKey].newValue))
		browser.runtime.sendMessage({ type: 'RAINDROP_RUNTIME_DOMAIN_CHANGED' }).catch(() => {})
	})
}

if (enabled && typeof document !== 'undefined' && document.getElementById('react')) {
	browser.runtime.onMessage.addListener(message => {
		if (message?.type === 'RAINDROP_RUNTIME_DOMAIN_CHANGED') location.reload()
	})
}

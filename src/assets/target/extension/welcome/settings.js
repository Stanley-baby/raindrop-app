const runtimeDomainMode = __RUNTIME_DOMAIN_MODE__
const storageKey = 'raindropRuntimeDomain'
const extensionApi = window.browser || window.chrome
const form = document.querySelector('#runtime-domain-form')
const status = document.querySelector('#status')
const saveButton = document.querySelector('#save')
const appInput = document.querySelector('#app-origin')
const apiInput = document.querySelector('#api-origin')
const openApp = document.querySelector('#open-app')

function call(api, method, ...args) {
    if (window.browser)
        return api[method](...args)

    return new Promise((resolve, reject) => {
        api[method](...args, value => {
            const error = extensionApi.runtime.lastError
            if (error) reject(new Error(error.message))
            else resolve(value)
        })
    })
}

function show(message, state) {
    status.textContent = message
    status.dataset.state = state
}

if (!runtimeDomainMode) {
    form.hidden = true
    show('Runtime server configuration is available only in self-hosted builds.', 'error')
} else {
    call(extensionApi.storage.sync, 'get', storageKey).then(values => {
        const saved = values[storageKey] || {}
        appInput.value = saved.appOrigin || ''
        apiInput.value = saved.apiOrigin || ''
    }).catch(error => show(error.message || 'Unable to read saved settings.', 'error'))

    form.addEventListener('submit', async event => {
        event.preventDefault()
        openApp.hidden = true

        let appOrigin
        let apiOrigin
        try {
            appOrigin = window.normalizeRuntimeOrigin(appInput.value)
            apiOrigin = window.normalizeRuntimeOrigin(apiInput.value)
        } catch (error) {
            show(error.message, 'error')
            return
        }

        saveButton.disabled = true
        show('Requesting access and checking the API…', 'pending')

        try {
            const granted = await call(extensionApi.permissions, 'request', {
                origins: [`${apiOrigin}/*`]
            })
            if (!granted) throw new Error('API host access was not granted.')

            const response = await fetch(`${apiOrigin}/health`, { cache: 'no-store', credentials: 'omit' })
            const health = await response.json()
            if (!response.ok || health.status !== 'ok') throw new Error('The API health check did not pass.')

            await call(extensionApi.storage.sync, 'set', {
                [storageKey]: { apiOrigin, appOrigin }
            })

            openApp.href = `${appOrigin}/account/login`
            openApp.hidden = false
            show('Settings saved. The API is reachable; reopen the extension if it was already open.', 'success')
        } catch (error) {
            show(error.message || 'Unable to save or verify the server settings.', 'error')
        } finally {
            saveButton.disabled = false
        }
    })
}

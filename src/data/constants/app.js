export const
	APP_DOMAIN 			= 'raindrop.io'

const defaultAppOrigin = process.env.NODE_ENV == 'production' ? 'https://app.example.com' : 'http://localhost:2000'
const defaultWorkersBaseUrl = process.env.RAINDROP_INDEPENDENT_SERVICE == 'true' ? '' : 'https://rdl.ink'
const runtimeDomainMode = process.env.RUNTIME_DOMAIN_MODE == 'true'
const runtimeWebMode = runtimeDomainMode && process.env.APP_TARGET == 'web'
const runtimeExtensionMode = runtimeDomainMode && process.env.APP_TARGET == 'extension'
const runtimeOrigin = runtimeWebMode ? window.location.origin : ''

export let APP_BASE_URL = runtimeWebMode ? runtimeOrigin : runtimeExtensionMode ? '' : process.env.APP_ORIGIN || defaultAppOrigin

export const
	WORKERS_BASE_URL	= process.env.WORKERS_BASE_URL || defaultWorkersBaseUrl,
	LEGACY_WORKERS_BASE_URL=process.env.RAINDROP_INDEPENDENT_SERVICE == 'true' ? '' : `https://stella.${APP_DOMAIN}`

const defaultApiOrigin = process.env.NODE_ENV == 'production' || RAINDROP_ENVIRONMENT == 'react-native' ? 'https://api.example.com' : 'http://localhost:8787'
const defaultAiPageOrigin = process.env.NODE_ENV == 'production' ? 'https://app.example.com/ai' : 'http://localhost:5173/ai'
const trimTrailingSlash = value => String(value || '').replace(/\/+$/, '')
export let API_ORIGIN = trimTrailingSlash(runtimeWebMode ? runtimeOrigin : runtimeExtensionMode ? '' : process.env.API_ORIGIN || defaultApiOrigin)
export let AI_PAGE_ORIGIN = trimTrailingSlash(runtimeWebMode ? `${runtimeOrigin}/ai` : runtimeExtensionMode ? '' : process.env.AI_PAGE_ORIGIN || defaultAiPageOrigin)

export const
	FAVICON_URL = WORKERS_BASE_URL ? `${WORKERS_BASE_URL}/favicon` : ''

export let RENDER_URL = trimTrailingSlash(runtimeWebMode ? `${runtimeOrigin}/render` : runtimeExtensionMode ? '' : process.env.RENDER_URL || (WORKERS_BASE_URL ? `${WORKERS_BASE_URL}/render` : ''))

export function setRuntimeOrigins({ apiOrigin, appOrigin }) {
	if (!runtimeExtensionMode) return

	API_ORIGIN = trimTrailingSlash(apiOrigin)
	APP_BASE_URL = trimTrailingSlash(appOrigin)
	AI_PAGE_ORIGIN = APP_BASE_URL + '/ai'
	RENDER_URL = API_ORIGIN + '/render'
	API_ENDPOINT_URL = API_ORIGIN + '/v1/'
	BETA_AI_URL = AI_PAGE_ORIGIN
}

export const
	RECAPTCHA_SITE_KEY = '6LfB38wUAAAAAMX3VuFcriTz-Tb-qw7MD966XNnk'

export const
	TURNSTILE_SITE_KEY	= process.env.TURNSTILE_SITE_KEY || '',
	TURNSTILE_ENABLED	= process.env.TURNSTILE_ENABLED == 'true'

export let API_ENDPOINT_URL = API_ORIGIN ? `${API_ORIGIN}/v1/` : ''

export const
	API_RETRIES 		= 3,
	API_TIMEOUT 		= 30000,
	PREVIEW_URL			= process.env.PREVIEW_URL || (process.env.RAINDROP_INDEPENDENT_SERVICE == 'true' ? '' : 'https://preview.systems')

export let BETA_AI_URL = AI_PAGE_ORIGIN

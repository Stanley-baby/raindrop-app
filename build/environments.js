const profiles = require('../cloudflare/environments.json')

const trimTrailingSlash = value => String(value).replace(/\/+$/, '')
const asBoolean = (value, fallback) => value === undefined ? fallback : String(value) === 'true'
const defaultRepositoryUrl = 'https://github.com/your-org/your-repo'
const isReservedExampleOrigin = value => {
    try {
        const hostname = new URL(value).hostname.toLowerCase()
        return hostname === 'example.com' || hostname.endsWith('.example.com')
    } catch {
        return false
    }
}

const resolveEnvironment = (options={}) => {
    const name = options.environment || (options.production ? 'production' : 'local')
    const profile = profiles[name]

    if (!profile)
        throw new Error(`Unknown build environment: ${name}`)

    const runtimeDomainMode = options.runtimeDomainMode === true && name === 'selfhosted'
    const apiOrigin = runtimeDomainMode ? '' : trimTrailingSlash(options.apiOrigin || process.env.API_ORIGIN || profile.apiOrigin)
    const appOrigin = runtimeDomainMode ? '' : trimTrailingSlash(options.appOrigin || process.env.APP_ORIGIN || profile.appOrigin)
    const aiPageOrigin = trimTrailingSlash(
        runtimeDomainMode ? '' : options.aiPageOrigin || process.env.AI_PAGE_ORIGIN ||
        (name === 'selfhosted' ? `${appOrigin}/ai` : profile.aiPageOrigin)
    )
    const workersBaseUrl = trimTrailingSlash(options.workersBaseUrl ?? process.env.WORKERS_BASE_URL ?? profile.workersBaseUrl ?? '')
    const renderUrl = runtimeDomainMode ? '' : trimTrailingSlash(options.renderUrl ?? process.env.RENDER_URL ??
        (name === 'selfhosted' ? `${apiOrigin}/render` : workersBaseUrl ? `${workersBaseUrl}/render` : ''))

    if (options.production && name === 'selfhosted' && !runtimeDomainMode &&
        (apiOrigin === profile.apiOrigin || appOrigin === profile.appOrigin ||
            isReservedExampleOrigin(apiOrigin) || isReservedExampleOrigin(appOrigin) || isReservedExampleOrigin(aiPageOrigin)))
        throw new Error('Self-hosted production builds require non-placeholder API_ORIGIN and APP_ORIGIN; reserved example origin is not allowed')

    return {
        ...profile,
        name,
        independentService: profile.independentService ?? ['local', 'preview', 'beta'].includes(name),
        runtimeDomainMode,
        apiOrigin,
        appOrigin,
        aiPageOrigin,
        helpOrigin: trimTrailingSlash(options.helpOrigin || process.env.HELP_ORIGIN || profile.helpOrigin || defaultRepositoryUrl),
        repositoryUrl: trimTrailingSlash(options.repositoryUrl || process.env.REPOSITORY_URL || profile.repositoryUrl || defaultRepositoryUrl),
        workersBaseUrl,
        renderUrl,
        previewUrl: trimTrailingSlash(options.previewUrl ?? process.env.PREVIEW_URL ?? profile.previewUrl ?? ''),
        turnstileSiteKey: options.turnstileSiteKey || process.env.TURNSTILE_SITE_KEY || profile.turnstileSiteKey || '',
        turnstileEnabled: asBoolean(options.turnstileEnabled ?? process.env.TURNSTILE_ENABLED, profile.turnstileEnabled)
    }
}

module.exports = {
    profiles,
    resolveEnvironment
}

const profiles = require('../cloudflare/environments.json')

const trimTrailingSlash = value => String(value).replace(/\/+$/, '')
const asBoolean = (value, fallback) => value === undefined ? fallback : String(value) === 'true'
const defaultRepositoryUrl = 'https://github.com/your-org/your-repo'

const resolveEnvironment = (options={}) => {
    const name = options.environment || (options.production ? 'production' : 'local')
    const profile = profiles[name]

    if (!profile)
        throw new Error(`Unknown build environment: ${name}`)

    const apiOrigin = trimTrailingSlash(options.apiOrigin || process.env.API_ORIGIN || profile.apiOrigin)
    const appOrigin = trimTrailingSlash(options.appOrigin || process.env.APP_ORIGIN || profile.appOrigin)
    const aiPageOrigin = trimTrailingSlash(
        options.aiPageOrigin || process.env.AI_PAGE_ORIGIN ||
        (name === 'selfhosted' ? `${appOrigin}/ai` : profile.aiPageOrigin)
    )

    if (options.production && name === 'selfhosted' &&
        (apiOrigin === profile.apiOrigin || appOrigin === profile.appOrigin))
        throw new Error('Self-hosted production builds require API_ORIGIN and APP_ORIGIN')

    return {
        ...profile,
        name,
        independentService: profile.independentService ?? ['local', 'preview', 'beta'].includes(name),
        apiOrigin,
        appOrigin,
        aiPageOrigin,
        helpOrigin: trimTrailingSlash(options.helpOrigin || process.env.HELP_ORIGIN || profile.helpOrigin || defaultRepositoryUrl),
        repositoryUrl: trimTrailingSlash(options.repositoryUrl || process.env.REPOSITORY_URL || profile.repositoryUrl || defaultRepositoryUrl),
        workersBaseUrl: trimTrailingSlash(options.workersBaseUrl ?? process.env.WORKERS_BASE_URL ?? profile.workersBaseUrl ?? ''),
        previewUrl: trimTrailingSlash(options.previewUrl ?? process.env.PREVIEW_URL ?? profile.previewUrl ?? ''),
        turnstileSiteKey: options.turnstileSiteKey || process.env.TURNSTILE_SITE_KEY || profile.turnstileSiteKey || '',
        turnstileEnabled: asBoolean(options.turnstileEnabled ?? process.env.TURNSTILE_ENABLED, profile.turnstileEnabled)
    }
}

module.exports = {
    profiles,
    resolveEnvironment
}

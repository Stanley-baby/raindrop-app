import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const environments = require('../environments.json')
const web = require('../../build/web.js')
const extension = require('../../build/extension.js')
const manifest = require('../../src/target/extension/manifest/index.js')

const profiles = ['local', 'preview', 'beta', 'production', 'selfhosted']
const definitionsFor = config => config.plugins.find(plugin =>
    plugin.definitions?.['process.env.API_ORIGIN'])?.definitions
const valueFor = (definitions, name) => JSON.parse(definitions[`process.env.${name}`])

test('Web and Chrome profiles inject matching origins and API host permissions', () => {
    for (const name of profiles) {
        const profile = environments[name]
        const webConfig = web({ environment: name })
        const chromeConfig = extension({ environment: name, vendor: 'chrome' })
        const webDefinitions = definitionsFor(webConfig)
        const chromeDefinitions = definitionsFor(chromeConfig)

        for (const [definitions, isWeb] of [[webDefinitions, true], [chromeDefinitions, false]]) {
            const usesRuntimeDomain = name === 'selfhosted'
            assert.equal(valueFor(definitions, 'RUNTIME_DOMAIN_MODE'), String(usesRuntimeDomain))
            assert.equal(valueFor(definitions, 'API_ORIGIN'), usesRuntimeDomain ? '' : profile.apiOrigin)
            assert.equal(valueFor(definitions, 'AI_PAGE_ORIGIN'), usesRuntimeDomain ? '' : profile.aiPageOrigin)
            assert.equal(valueFor(definitions, 'APP_ORIGIN'), usesRuntimeDomain ? '' : profile.appOrigin)
            assert.equal(valueFor(definitions, 'HELP_ORIGIN'), profile.helpOrigin)
            assert.equal(valueFor(definitions, 'REPOSITORY_URL'), profile.repositoryUrl)
            assert.equal(valueFor(definitions, 'WORKERS_BASE_URL'), profile.workersBaseUrl)
            assert.equal(valueFor(definitions, 'RENDER_URL'), usesRuntimeDomain ? '' : name === 'selfhosted'
                ? `${profile.apiOrigin}/render`
                : profile.workersBaseUrl ? `${profile.workersBaseUrl}/render` : '')
            assert.equal(valueFor(definitions, 'PREVIEW_URL'), profile.previewUrl)
            assert.equal(valueFor(definitions, 'TURNSTILE_SITE_KEY'), profile.turnstileSiteKey)
            assert.equal(valueFor(definitions, 'TURNSTILE_ENABLED'), String(profile.turnstileEnabled))
            assert.equal(valueFor(definitions, 'RAINDROP_BUILD_ENVIRONMENT'), name)
        }

        assert.equal(
            webConfig.output.path,
            path.resolve(process.cwd(), 'dist', 'web', name === 'local' ? 'dev' : name === 'production' ? 'prod' : name)
        )
        assert.equal(
            chromeConfig.output.path,
            path.resolve(process.cwd(), 'dist', 'chrome', name === 'local' ? 'dev' : name === 'production' ? 'prod' : name)
        )

        const generated = manifest({ vendor: 'chrome', apiOrigin: profile.apiOrigin, appOrigin: profile.appOrigin }, { emitFile() {} })
        assert.deepEqual(JSON.parse(generated.code).host_permissions, [`${new URL(profile.apiOrigin).origin}/*`])
        assert.equal(JSON.parse(generated.code).homepage_url, profile.appOrigin)
    }
})

test('Chrome extension names identify production and self-hosted builds', () => {
    const generatedName = options => JSON.parse(manifest({
        vendor: 'chrome',
        production: true,
        ...options
    }, { emitFile() {} }).code).name

    assert.equal(generatedName({ environment: 'production' }), 'Raindrop.io (Production)')
    assert.equal(generatedName({ environment: 'selfhosted' }), 'Raindrop.io (Self-hosted)')
})

test('Pages serves client-side routes through the Web entry point', () => {
    assert.match(fs.readFileSync(new URL('../../src/assets/_redirects', import.meta.url), 'utf8'), /^\/\*\s+\/index\.html\s+200$/m)
    const routes = JSON.parse(fs.readFileSync(new URL('../../src/assets/_routes.json', import.meta.url), 'utf8'))
    const selfHostedRoutes = JSON.parse(fs.readFileSync(new URL('../../src/assets/_routes.selfhosted.json', import.meta.url), 'utf8'))
    assert.deepEqual(routes.include, ['/pb/*', '/account/login'])
    assert.deepEqual(selfHostedRoutes.include, ['/v1/*', '/v2/*', '/health', '/version', '/render/*', '/public/content/*', '/pb/*', '/account/login'])
})

test('Pages framing allows the Web origin and Chrome extension AI host UI', () => {
    const headers = fs.readFileSync(new URL('../../src/assets/_headers', import.meta.url), 'utf8')
    assert.match(headers, /\/\*\s+Content-Security-Policy: frame-ancestors 'self' chrome-extension:\/\/\* moz-extension:\/\/\* safari-web-extension:\/\/\*/m)
    assert.doesNotMatch(headers, /X-Frame-Options/i)
})

test('Chrome extension development and Beta builds stay isolated', () => {
    assert.equal(extension({ vendor: 'chrome' }).devServer.port, 2001)
    assert.equal(extension({ vendor: 'edge' }).devServer.port, 2000)

    const betaConfig = extension({ environment: 'beta', production: true, vendor: 'chrome' })
    const archive = betaConfig.plugins.find(plugin => plugin.constructor.name == 'ZipPlugin')
    assert.equal(archive.options.filename, 'chrome-beta.zip')
})

test('Independent Service capability is enabled for self-hosted profiles', () => {
    for (const name of ['local', 'preview', 'beta', 'production', 'selfhosted']) {
        const definitions = definitionsFor(web({ environment: name }))
        assert.equal(valueFor(definitions, 'RAINDROP_INDEPENDENT_SERVICE'), 'true')
    }
})

test('staging, production, and self-hosted rollout switches keep scanners off and archiving manual', () => {
    const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
    for (const name of ['preview', 'beta', 'production', 'selfhosted']) {
        const profile = environments[name]
        const start = wrangler.indexOf(`[env.${name}.vars]`)
        const end = wrangler.indexOf('\n[', start + 1)
        const vars = wrangler.slice(start, end < 0 ? undefined : end)
        const value = key => vars.match(new RegExp(`^${key} = "([^"]*)"$`, 'm'))?.[1]

        assert.equal(profile.attachmentScanEnabled, false, `${name} attachment scan`)
        assert.equal(profile.archiveScanEnabled, false, `${name} archive scan`)
        assert.equal(profile.archiveV2Enabled, true, `${name} archive feature`)
        assert.equal(profile.archiveAutoCapture, false, `${name} automatic capture`)
        assert.equal(profile.duplicateCheckV15Enabled, true, `${name} duplicate review`)
        assert.equal(value('ATTACHMENT_SCAN_ENABLED'), 'false', `${name} ATTACHMENT_SCAN_ENABLED`)
        assert.equal(value('ARCHIVE_SCAN_ENABLED'), 'false', `${name} ARCHIVE_SCAN_ENABLED`)
        assert.equal(value('ARCHIVE_V2_ENABLED'), 'true', `${name} ARCHIVE_V2_ENABLED`)
        assert.equal(value('ARCHIVE_AUTO_CAPTURE'), 'false', `${name} ARCHIVE_AUTO_CAPTURE`)
        assert.equal(value('DUPLICATE_CHECK_V15_ENABLED'), 'true', `${name} DUPLICATE_CHECK_V15_ENABLED`)
        assert.match(wrangler, new RegExp(`\\[env\\.${name}\\.triggers\\]\\s+crons = \\["0 \\* \\* \\* \\*"\\]`))
    }
})

test('self-hosted Web and extensions use runtime origins while production profiles stay fixed', () => {
    const options = {
        environment: 'selfhosted',
        apiOrigin: 'https://api.operator.example',
        appOrigin: 'https://app.operator.example',
        helpOrigin: 'https://github.com/operator/bookmarks'
    }
    const definitions = definitionsFor(web(options))

    assert.equal(valueFor(definitions, 'RUNTIME_DOMAIN_MODE'), 'true')
    assert.equal(valueFor(definitions, 'API_ORIGIN'), '')
    assert.equal(valueFor(definitions, 'APP_ORIGIN'), '')
    assert.equal(valueFor(definitions, 'AI_PAGE_ORIGIN'), '')
    assert.equal(valueFor(definitions, 'HELP_ORIGIN'), 'https://github.com/operator/bookmarks')
    assert.equal(valueFor(definitions, 'WORKERS_BASE_URL'), '')
    assert.equal(valueFor(definitions, 'RENDER_URL'), '')

    const customRenderer = definitionsFor(web({ ...options, renderUrl: 'https://render.operator.example/' }))
    assert.equal(valueFor(customRenderer, 'RENDER_URL'), '')

    const chromeDefinitions = definitionsFor(extension({ ...options, vendor: 'chrome' }))
    assert.equal(valueFor(chromeDefinitions, 'RUNTIME_DOMAIN_MODE'), 'true')
    assert.equal(valueFor(chromeDefinitions, 'API_ORIGIN'), '')
    assert.equal(valueFor(chromeDefinitions, 'APP_ORIGIN'), '')
    assert.equal(valueFor(chromeDefinitions, 'AI_PAGE_ORIGIN'), '')

    const selfHostedManifest = JSON.parse(manifest({
        vendor: 'chrome',
        environment: 'selfhosted',
        runtimeDomainMode: true,
        apiOrigin: '',
        appOrigin: ''
    }, { emitFile() {} }).code)
    assert.deepEqual(selfHostedManifest.host_permissions, [])
    assert.equal(selfHostedManifest.options_ui.page, 'welcome/settings.html')
    assert.equal('homepage_url' in selfHostedManifest, false)
})

test('self-hosted Web and extension production builds do not need build-time origins', () => {
    assert.equal(valueFor(definitionsFor(web({ environment: 'selfhosted', production: true })), 'RUNTIME_DOMAIN_MODE'), 'true')
    assert.equal(valueFor(definitionsFor(extension({ environment: 'selfhosted', production: true, vendor: 'chrome' })), 'RUNTIME_DOMAIN_MODE'), 'true')
})

test('self-hosted production builds reject reserved example origins when supplied explicitly', () => {
    const options = {
        environment: 'selfhosted',
        production: true,
        apiOrigin: 'https://api.example.com',
        appOrigin: 'https://app.operator.example',
        aiPageOrigin: 'https://app.operator.example/ai'
    }
    assert.equal(valueFor(definitionsFor(web(options)), 'RUNTIME_DOMAIN_MODE'), 'true')
    assert.equal(valueFor(definitionsFor(extension({ ...options, vendor: 'chrome' })), 'RUNTIME_DOMAIN_MODE'), 'true')
})

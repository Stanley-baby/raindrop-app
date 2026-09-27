import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import worker from '../src/index.js'

globalThis.crypto ||= webcrypto

const routerSource = await readFile(new URL('../../functions/[[path]].js', import.meta.url), 'utf8')
const { onRequest } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(routerSource))

test('Pages API function forwards the original request to its Worker service binding', async () => {
    let forwarded
    const request = new Request('https://bookmarks.example/v1/health', {
        method: 'POST',
        headers: { Cookie: 'session=secret', 'Content-Type': 'application/json' },
        body: '{"probe":true}'
    })
    const response = await onRequest({
        request,
        env: { API: { fetch: async value => { forwarded = value; return new Response('forwarded') } } },
        next: () => new Response('static')
    })

    assert.equal(await response.text(), 'forwarded')
    assert.equal(forwarded.url, request.url)
    assert.equal(forwarded.method, 'POST')
    assert.equal(forwarded.headers.get('Cookie'), 'session=secret')
    assert.equal(await forwarded.text(), '{"probe":true}')
})

test('Pages API function leaves application routes on Pages and reports a missing binding', async () => {
    const staticResponse = await onRequest({
        request: new Request('https://bookmarks.example/my/0'),
        env: {},
        next: () => new Response('static')
    })
    assert.equal(await staticResponse.text(), 'static')

    const missingBinding = await onRequest({
        request: new Request('https://bookmarks.example/v2/ai/config'),
        env: {},
        next: () => new Response('static')
    })
    assert.equal(missingBinding.status, 503)
    assert.deepEqual(await missingBinding.json(), { result: false, error: 'api_binding_missing' })
})

test('Pages-to-Worker forwarding keeps the custom host for runtime origin resolution', async () => {
    const origin = 'https://bookmarks.example'
    const response = await onRequest({
        request: new Request(origin + '/health', { headers: { Origin: origin } }),
        env: {
            API: { fetch: request => worker.fetch(request, {
                ENVIRONMENT: 'selfhosted',
                RUNTIME_DOMAIN_MODE: 'true',
                CORS_ORIGINS: 'chrome-extension://*'
            }) }
        },
        next: () => new Response('static')
    })

    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'ok')
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
})

test('self-hosted Worker reflects only its current request origin for credentialed CORS', async () => {
    const env = { ENVIRONMENT: 'selfhosted', RUNTIME_DOMAIN_MODE: 'true', CORS_ORIGINS: 'chrome-extension://*' }
    const sameOrigin = await worker.fetch(new Request('https://bookmarks.example/health', {
        headers: { Origin: 'https://bookmarks.example' }
    }), env)
    assert.equal(sameOrigin.headers.get('Access-Control-Allow-Origin'), 'https://bookmarks.example')
    assert.equal(sameOrigin.headers.get('Access-Control-Allow-Credentials'), 'true')

    const otherOrigin = await worker.fetch(new Request('https://bookmarks.example/health', {
        headers: { Origin: 'https://attacker.example' }
    }), env)
    assert.equal(otherOrigin.headers.get('Access-Control-Allow-Origin'), null)
})

test('self-hosted Worker supports separate API and Web origins without reflecting arbitrary origins', async () => {
    const response = await worker.fetch(new Request('https://api.bookmarks.example/health', {
        headers: { Origin: 'https://app.bookmarks.example' }
    }), {
        ENVIRONMENT: 'selfhosted',
        RUNTIME_DOMAIN_MODE: 'true',
        APP_ORIGIN: 'https://app.bookmarks.example',
        CORS_ORIGINS: 'chrome-extension://*'
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.bookmarks.example')
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true')

    const rejected = await worker.fetch(new Request('https://api.bookmarks.example/health', {
        headers: { Origin: 'https://attacker.example' }
    }), {
        ENVIRONMENT: 'selfhosted',
        RUNTIME_DOMAIN_MODE: 'true',
        APP_ORIGIN: 'https://app.bookmarks.example',
        CORS_ORIGINS: 'chrome-extension://*'
    })
    assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null)
})

test('self-hosted OAuth callback URL follows the incoming custom domain', async () => {
    const DB = {
        prepare() {
            return { bind() { return { run: async () => ({ meta: { changes: 1 } }) } } }
        }
    }
    const response = await worker.fetch(new Request('https://bookmarks.example/v1/auth/google?redirect=%2Fmy%2F0'), {
        ENVIRONMENT: 'selfhosted',
        RUNTIME_DOMAIN_MODE: 'true',
        API_ORIGIN: 'https://api.old.example',
        APP_ORIGIN: 'https://app.old.example',
        AI_PAGE_ORIGIN: 'https://app.old.example/ai',
        CORS_ORIGINS: 'chrome-extension://*',
        SESSION_SECRET: 'test-session-secret',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        DB
    })

    assert.equal(response.status, 302)
    const location = new URL(response.headers.get('Location'))
    assert.equal(location.searchParams.get('redirect_uri'), 'https://bookmarks.example/v1/auth/google/callback')

    const failedCallback = await worker.fetch(new Request('https://bookmarks.example/v1/auth/google/callback?state=invalid&code=fixture'), {
        ENVIRONMENT: 'selfhosted',
        RUNTIME_DOMAIN_MODE: 'true',
        API_ORIGIN: 'https://api.old.example',
        APP_ORIGIN: '',
        CORS_ORIGINS: 'chrome-extension://*',
        SESSION_SECRET: 'test-session-secret',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        DB: {
            prepare() {
                return { bind() { return {
                    run: async () => ({ meta: { changes: 1 } }),
                    first: async () => null
                } } }
            }
        }
    })
    assert.equal(failedCallback.status, 303)
    assert.equal(new URL(failedCallback.headers.get('Location')).origin, 'https://bookmarks.example')
})

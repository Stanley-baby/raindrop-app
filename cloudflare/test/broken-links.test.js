/* global globalThis */

import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { probeLink, scheduleBrokenLinkChecks, validateFetchableUrl } from '../src/index.js'

globalThis.crypto ||= webcrypto

test('probeLink classifies the V1 status matrix', async t => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    const calls = []
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options.method })
        const path = new URL(url).pathname
        if (path === '/not-found') return new Response(null, { status: 404 })
        if (path === '/forbidden') return new Response(null, { status: 403 })
        if (path === '/server-error') return new Response(null, { status: 500 })
        return new Response(null, { status: 200 })
    }

    assert.equal((await probeLink('https://example.test/ok', 'default')).state, 'ok')
    const notFound = await probeLink('https://example.test/not-found', 'default')
    assert.equal(notFound.state, 'broken')
    assert.equal(notFound.broken, true)
    assert.equal(notFound.reason, 'http_404')
    assert.equal(notFound.httpStatus, 404)
    assert.equal(notFound.retryable, false)
    assert.equal((await probeLink('https://example.test/forbidden', 'strict')).state, 'uncertain')
    assert.equal((await probeLink('https://example.test/server-error', 'default')).reason, 'server_error')
    assert.equal((await probeLink('https://example.test/server-error', 'strict')).retryable, true)
    assert.deepEqual(calls.map(item => item.method), ['HEAD', 'HEAD', 'HEAD', 'HEAD', 'HEAD'])
})

test('probeLink falls back to a bounded GET and revalidates redirects', async t => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    const calls = []
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options.method, headers: options.headers })
        const path = new URL(url).pathname
        if (path === '/head-unsupported') return new Response(null, { status: options.method === 'HEAD' ? 405 : 204 })
        if (path === '/redirect') return new Response(null, { status: 302, headers: { Location: '/ok' } })
        return new Response(null, { status: 200 })
    }

    const fallback = await probeLink('https://example.test/head-unsupported')
    assert.equal(fallback.state, 'ok')
    assert.equal(calls[1].method, 'GET')
    assert.equal(calls[1].headers.Range, 'bytes=0-0')

    const redirected = await probeLink('https://example.test/redirect')
    assert.equal(redirected.state, 'ok')
    assert.equal(redirected.finalUrl, 'https://example.test/ok')
})

test('probeLink blocks private redirects before issuing the second request', async t => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    let count = 0
    globalThis.fetch = async () => {
        count++
        return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } })
    }
    const result = await probeLink('https://example.test/private-redirect')
    assert.equal(result.reason, 'dns_failed')
    assert.equal(count, 1)
    assert.equal(validateFetchableUrl('http://127.0.0.1/admin').ok, false)
})

test('processLinkCheckTask commits a confirmed result only for the current URL/version', async t => {
    const { processLinkCheckTask } = await import('../src/index.js')
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    globalThis.fetch = async () => new Response(null, { status: 404 })

    const task = {
        id: 'link-task', user_id: 1, bookmark_id: 7, type: 'link_check', status: 'queued', progress: 0,
        retry_count: 0, source_url: 'https://example.test/dead', payload: JSON.stringify({ mode: 'default', checkVersion: 2 }),
        result_metadata: '{}', error_code: null, error_message: null, next_retry_at: null,
        created_at: 1, updated_at: 1, completed_at: null
    }
    const bookmark = {
        id: 7, user_id: 1, url: 'https://example.test/dead', broken: 0, broken_state: 'unknown',
        broken_reason: '', broken_failure_count: 0, broken_check_version: 2
    }
    const db = {
        prepare(sql) {
            let values = []
            const first = async () => sql.includes('FROM background_tasks') ? task : sql.includes('FROM bookmarks') ? bookmark : null
            const run = async () => {
                if (sql.includes('SET status = \'processing\'')) {
                    task.status = 'processing'
                    task.updated_at = values[0]
                    return { meta: { changes: 1 } }
                }
                if (sql.includes('UPDATE bookmarks SET broken_state')) {
                    Object.assign(bookmark, {
                        broken_state: values[0], broken: values[1], broken_reason: values[2],
                        broken_http_status: values[3], broken_final_url: values[4], broken_checked_at: values[5],
                        broken_next_check_at: values[6], broken_failure_count: values[7]
                    })
                    return { meta: { changes: 1 } }
                }
                if (sql.includes('SET status = \'succeeded\'')) {
                    task.status = 'succeeded'
                    task.result_metadata = values[0]
                    return { meta: { changes: 1 } }
                }
                return { meta: { changes: 1 } }
            }
            return { bind: (...next) => { values = next; return { first, run } } }
        }
    }
    const result = await processLinkCheckTask({ DB: db, API_ORIGIN: 'https://api.example.test' }, task.id)
    assert.equal(result.action, 'ack')
    assert.equal(bookmark.broken_state, 'broken')
    assert.equal(bookmark.broken, 1)
    assert.equal(bookmark.broken_reason, 'http_404')
    assert.equal(task.status, 'succeeded')
})

test('scheduled link checks skip disabled users without starving later eligible bookmarks', async () => {
    const queued = []
    const task = {
        id: 'scheduled-link-task', user_id: 2, bookmark_id: 2, type: 'link_check', status: 'queued', progress: 0,
        retry_count: 0, idempotency_key: 'link_check:2', source_url: 'https://example.test/eligible', payload: '{}',
        result_metadata: '{}', error_code: null, error_message: null, next_retry_at: null,
        created_at: 1, updated_at: 1, completed_at: null
    }
    const rows = [
        { id: 1, user_id: 1, url: 'https://example.test/disabled', broken_check_version: 1, broken_next_check_at: null, config: '{"broken_level":"off"}' },
        { id: 2, user_id: 2, url: 'https://example.test/eligible', broken_check_version: 1, broken_next_check_at: null, config: '{"broken_level":"default"}' }
    ]
    const db = {
        prepare(sql) {
            let values = []
            const first = async () => sql.includes('FROM background_tasks') ? task : null
            const all = async () => ({ results: sql.includes('FROM bookmarks b JOIN users') ? [rows[Number(values[2] || 0)]].filter(Boolean) : [] })
            const run = async () => ({ meta: { changes: 1 } })
            return { bind: (...next) => { values = next; return { first, all, run } } }
        }
    }
    const result = await scheduleBrokenLinkChecks({
        DB: db,
        TASK_QUEUE: { send: async body => queued.push(body) },
        BROKEN_LINK_BATCH_LIMIT: '1'
    }, 1)
    assert.deepEqual(result, { queued: 1, skipped: 1 })
    assert.deepEqual(queued, [{ taskId: task.id, type: 'link_check' }])
})

import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { archiveAutoCaptureEnabled, createArchiveTask } from '../src/index.js'
import {
    archiveHash,
    archiveText,
    extractArchiveAssets,
    rewriteArchiveAssetUrls,
    sanitizeArchiveHtml
} from '../src/webArchive.js'

globalThis.crypto ||= webcrypto

test('archive HTML removes executable content and extracts safe assets', async () => {
    const source = 'https://example.test/article'
    const input = '<html><head><title>Archive title</title><script>alert(1)</script><link rel="stylesheet" href="/app.css"></head><body><img src="/cover.png" onerror="alert(2)"><a href="/next">Next</a></body></html>'
    const clean = sanitizeArchiveHtml(input)
    assert.doesNotMatch(clean, /script|onerror/i)
    assert.deepEqual(extractArchiveAssets(clean, source), [
        'https://example.test/cover.png',
        'https://example.test/app.css'
    ])
    const rewritten = rewriteArchiveAssetUrls(clean, source, {
        'https://example.test/cover.png': '/v1/archive/v1/assets/a1',
        'https://example.test/app.css': '/v1/archive/v1/assets/a2'
    })
    assert.match(rewritten, /\/v1\/archive\/v1\/assets\/a1/)
    assert.match(rewritten, /\/v1\/archive\/v1\/assets\/a2/)
    assert.match(archiveText(clean), /Archive title|Next/)
    assert.equal((await archiveHash(new TextEncoder().encode('archive'))).length, 64)
})

test('archive auto capture supports a staging account allowlist', () => {
    assert.equal(archiveAutoCaptureEnabled({ ARCHIVE_AUTO_CAPTURE: 'true' }, 2), false)
    assert.equal(archiveAutoCaptureEnabled({ ARCHIVE_AUTO_CAPTURE: 'true', ARCHIVE_AUTO_CAPTURE_USER_IDS: '2' }, 2), true)
    assert.equal(archiveAutoCaptureEnabled({ ARCHIVE_AUTO_CAPTURE: 'true', ARCHIVE_AUTO_CAPTURE_USER_IDS: '2' }, 1), false)
    assert.equal(archiveAutoCaptureEnabled({ ARCHIVE_AUTO_CAPTURE: 'false', ARCHIVE_AUTO_CAPTURE_USER_IDS: '2' }, 2), false)
})

test('staging auto capture queues only the allowlisted account', async () => {
    const tasks = []
    const queued = []
    const db = {
        prepare(sql) {
            let values = []
            const first = async () => {
                if (sql.includes('FROM bookmarks'))
                    return values[1] === 2 ? { id: 70, user_id: 2, url: 'https://example.com', removed_at: null } : null
                if (sql.includes('FROM web_archives')) return null
                if (sql.includes('FROM background_tasks'))
                    return tasks.find(task => task.id === values[0] && task.user_id === values[1]) || null
                return null
            }
            const run = async () => {
                if (sql.includes('INSERT INTO background_tasks')) {
                    const [id, userId, bookmarkId, type, key, sourceUrl, payload, createdAt, updatedAt] = values
                    const task = { id, user_id: userId, bookmark_id: bookmarkId, type, status: 'queued', progress: 0, retry_count: 0, idempotency_key: key, source_url: sourceUrl, content_id: null, payload, result_metadata: '{}', error_code: null, error_message: null, next_retry_at: null, created_at: createdAt, updated_at: updatedAt, completed_at: null }
                    tasks.push(task)
                }
                return { meta: { changes: 1 } }
            }
            return { bind: (...next) => { values = next; return { first, run } } }
        }
    }
    const env = {
        DB: db,
        TASK_QUEUE: { send: async body => queued.push(body) },
        ARCHIVE_V2_ENABLED: 'true',
        ARCHIVE_AUTO_CAPTURE: 'true',
        ARCHIVE_AUTO_CAPTURE_USER_IDS: '2',
        ARCHIVE_RETENTION_DAYS: '365'
    }
    const allowed = await createArchiveTask(env, null, 2, 70, { trigger: 'create' })
    const skipped = await createArchiveTask(env, null, 1, 70, { trigger: 'create' })
    assert.equal(allowed.type, 'archive_capture')
    assert.equal(allowed.status, 'queued')
    assert.equal(skipped, null)
    assert.deepEqual(queued, [{ taskId: allowed.id, type: 'archive_capture' }])
})

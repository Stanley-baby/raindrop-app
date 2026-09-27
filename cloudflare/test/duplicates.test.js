import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { normalizeBookmarkUrl } from '../src/duplicates.js'
import { processDuplicateScanTask } from '../src/index.js'

globalThis.crypto ||= webcrypto

test('normalizeBookmarkUrl keeps exact URL semantics and creates a safe tracking key', () => {
    const exact = normalizeBookmarkUrl('HTTPS://WWW.Example.com:443/docs#intro?utm_source=ignored')
    assert.equal(exact.exactUrl, 'https://www.example.com/docs#intro?utm_source=ignored')
    assert.equal(exact.normalizedUrl, 'https://www.example.com/docs')
    assert.equal(exact.hostAliasUrl, 'https://example.com/docs')
    assert.deepEqual(exact.evidence.removedQueryParams, [])
    assert.equal(exact.evidence.removedFragment, 'intro?utm_source=ignored')
})

test('normalizeBookmarkUrl removes only allow-listed tracking parameters', () => {
    const first = normalizeBookmarkUrl('https://example.com/docs?b=2&utm_source=news&a=1#part')
    const second = normalizeBookmarkUrl('https://example.com/docs?a=1&b=2&utm_medium=email')
    const third = normalizeBookmarkUrl('https://example.com/docs?ref=manual')
    assert.equal(first.normalizedUrl, 'https://example.com/docs?a=1&b=2')
    assert.equal(second.normalizedUrl, 'https://example.com/docs?a=1&b=2')
    assert.notEqual(first.normalizedUrl, third.normalizedUrl)
})

test('normalizeBookmarkUrl treats HTTP and HTTPS as distinct candidates', () => {
    const http = normalizeBookmarkUrl('http://example.com/docs')
    const https = normalizeBookmarkUrl('https://example.com/docs')
    assert.notEqual(http.exactUrl, https.exactUrl)
    assert.notEqual(http.normalizedUrl, https.normalizedUrl)
})

test('normalizeBookmarkUrl ignores non-web attachments and malformed URLs', () => {
    assert.equal(normalizeBookmarkUrl('attachment://file/1'), null)
    assert.equal(normalizeBookmarkUrl('not a URL'), null)
})

test('processDuplicateScanTask indexes and groups duplicate URLs across queue continuations', async () => {
    const now = Date.now()
    class Database {
        constructor() {
            this.task = {
                id: 'duplicate-task', user_id: 1, bookmark_id: null, type: 'duplicate_scan', status: 'queued',
                progress: 0, retry_count: 0, idempotency_key: 'duplicate-task', source_url: '', content_id: null,
                payload: JSON.stringify({ scanId: 'scan-1', scopeCollectionId: 0, mode: 'safe' }), result_metadata: '{}',
                error_code: null, error_message: null, next_retry_at: null, created_at: now, updated_at: now, completed_at: null
            }
            this.run = { id: 'scan-1', user_id: 1, scope_collection_id: 0, mode: 'safe', phase: 'index', status: 'queued', cursor_id: 0, groups_found: 0, candidates_found: 0 }
            this.bookmarks = [
                { id: 1, user_id: 1, url: 'https://example.com/docs', title: 'Docs', description: '', note: '', cover: '', media: '[]', collection_id: -1, tags: '[]', highlights: '[]', created_at: 1, change_version: 1 },
                { id: 2, user_id: 1, url: 'https://example.com/docs?utm_source=test', title: 'Docs copy', description: '', note: '', cover: '', media: '[]', collection_id: -1, tags: '[]', highlights: '[]', created_at: 2, change_version: 2 }
            ]
            this.keys = []
            this.groups = []
        }

        prepare(sql) {
            let values = []
            const first = async () => {
                if (sql.includes('FROM background_tasks')) return this.task
                if (sql.includes('FROM duplicate_scan_runs')) return this.run
                if (sql.includes('FROM duplicate_groups')) return null
                return null
            }
            const all = async () => {
                if (sql.includes('FROM bookmarks b WHERE')) {
                    const cursor = Number(values[1] || 0)
                    const limit = Number(values.at(-1) || 500)
                    return { results: this.bookmarks.filter(item => item.id > cursor && !item.removed_at).slice(0, limit) }
                }
                if (sql.includes('FROM bookmark_url_keys k JOIN bookmarks b')) {
                    return { results: this.keys.map(key => ({ ...key, ...this.bookmarks.find(item => item.id === key.bookmark_id) })) }
                }
                return { results: [] }
            }
            const run = async () => {
                if (sql.includes('SET status = \'processing\'')) this.task.status = 'processing'
                if (sql.includes('INSERT INTO bookmark_url_keys')) {
                    const [bookmarkId, userId, canonicalVersion, exactHash, normalizedHash, hostAliasHash, finalHash, exactUrl, normalizedUrl] = values
                    const current = { bookmark_id: bookmarkId, user_id: userId, canonical_version: canonicalVersion, exact_hash: exactHash, normalized_hash: normalizedHash, host_alias_hash: hostAliasHash, final_hash: finalHash, exact_url: exactUrl, normalized_url: normalizedUrl }
                    this.keys = [...this.keys.filter(item => item.bookmark_id !== bookmarkId), current]
                }
                if (sql.includes('SET phase = \'group\'')) this.run.phase = 'group'
                if (sql.includes('SET cursor_id = ?')) this.run.cursor_id = Number(values[0])
                if (sql.includes('SET status = \'queued\'')) this.task.status = 'queued'
                if (sql.includes('SET status = \'succeeded\'')) this.task.status = 'succeeded'
                if (sql.includes('INSERT INTO duplicate_groups')) this.groups.push({ id: values[0], status: values[8], fingerprint: values[6] })
                return { meta: { changes: 1 } }
            }
            return { bind: (...next) => { values = next; return { first, all, run } } }
        }
    }

    const db = new Database()
    const queued = []
    const env = { DB: db, TASK_QUEUE: { send: async value => queued.push(value) }, SESSION_SECRET: 'test-secret' }
    assert.equal((await processDuplicateScanTask(env, 'duplicate-task')).action, 'ack')
    assert.equal(queued.length, 1)
    assert.equal(db.task.status, 'queued')
    assert.equal((await processDuplicateScanTask(env, 'duplicate-task')).action, 'ack')
    assert.equal(db.task.status, 'queued')
    assert.equal((await processDuplicateScanTask(env, 'duplicate-task')).action, 'ack')
    assert.equal(db.task.status, 'succeeded')
    assert.equal(db.groups.length, 1)
})

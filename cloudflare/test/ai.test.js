/* global Uint8Array, globalThis */

import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import worker from '../src/index.js'

globalThis.crypto ||= webcrypto

const hash = async (value, secret) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

class AiDatabase {
    constructor(secret) {
        this.secret = secret
        this.users = [
            { id: 1, email: 'one@example.test', name: 'One', email_verified_at: 1 },
            { id: 2, email: 'two@example.test', name: 'Two', email_verified_at: 1 }
        ]
        this.sessions = []
        this.chats = []
        this.messages = []
        this.bookmarks = []
        this.collections = []
        this.proposals = []
        this.standingApprovals = []
        this.providers = []
        this.alerts = []
        this.nextMessageId = 1
    }

    async addSession(token, userId) {
        this.sessions.push({ id: 'session-' + userId, user_id: userId, token_hash: await hash(token, this.secret), expires_at: Date.now() + 86400000 })
    }

    prepare(sql) {
        if (sql.includes('ai_usage')) throw new Error('application AI quota must not be queried')
        let values = []
        const first = async () => {
            if (sql.includes('FROM sessions s')) {
                const session = this.sessions.find(item => item.token_hash === values[0] && item.expires_at > values[1])
                const user = this.users.find(item => item.id === session?.user_id)
                return session && user ? { ...session, session_id: session.id, ...user, federated_only: 0, google_enabled: false } : null
            }
            if (sql.includes('FROM ai_action_proposals WHERE id')) return this.proposals.find(item => item.id === values[0] && item.user_id === values[1]) || null
            if (sql.includes('FROM ai_standing_approvals') && sql.includes('id = ?') && sql.includes('user_id = ?') && !sql.includes('tool_name = ?')) return this.standingApprovals.find(item => item.id === values[0] && item.user_id === values[1]) || null
            if (sql.includes('FROM ai_standing_approvals') && sql.includes('user_id = ?') && !sql.includes('WHERE id')) return this.standingApprovals.find(item =>
                item.user_id === values[0] && item.tool_name === values[1] && item.collection_id === values[2] && (!sql.includes('revoked_at IS NULL') || !item.revoked_at)) || null
            if (sql.includes('FROM ai_providers WHERE user_id')) return this.providers.find(item => item.user_id === values[0]) || null
            if (sql.includes('FROM ai_chats WHERE id')) return this.chats.find(item => item.id === values[0] && item.user_id === values[1]) || null
            if (sql.includes('FROM bookmarks WHERE id'))
                return this.bookmarks.find(item => item.id === values[0] && item.user_id === values[1] && !item.removed_at) || null
            if (sql.includes('FROM collections WHERE id')) return this.collections.find(item => item.id === values[0] && !item.removed_at) || null
            if (sql.includes('FROM bookmarks')) return null
            return null
        }
        const all = async () => {
            if (sql.includes('FROM bookmarks b')) return { results: this.bookmarks }
            if (sql.includes('FROM bookmarks WHERE user_id')) return { results: this.bookmarks.filter(item => item.user_id === values[0] && !item.removed_at) }
            if (sql.includes('FROM collections WHERE user_id')) return { results: this.collections.filter(item => item.user_id === values[0] && !item.removed_at) }
            if (sql.includes('FROM ai_action_proposals WHERE user_id')) return { results: this.proposals.filter(item =>
                item.user_id === values[0] && (!values[1] || item.status === values[1])) }
            if (sql.includes('FROM ai_standing_approvals WHERE user_id')) return { results: this.standingApprovals.filter(item => item.user_id === values[0] && !item.revoked_at) }
            if (sql.includes('FROM ai_chats WHERE user_id')) return { results: this.chats.filter(item => item.user_id === values[0]).map(item => ({ ...item })) }
            if (sql.includes('FROM ai_messages WHERE chat_id')) return { results: this.messages.filter(item => item.chat_id === values[0] && item.user_id === values[1]).sort((a, b) => b.created_at - a.created_at).slice(0, values[2]).map(item => ({ ...item })) }
            if (sql.includes('FROM ai_messages') && sql.includes('user_id = ?')) return { results: this.messages.filter(item => item.user_id === values[0]).map(item => ({ ...item })) }
            if (sql.includes('FROM ai_chats')) return { results: this.chats.filter(item => item.user_id === values[0]).map(item => ({ id: item.id })) }
            return { results: [] }
        }
        const run = async () => {
            if (sql.includes('INSERT INTO ai_chats')) {
                this.chats.push({ id: values[0], user_id: values[1], title: values[2], created_at: values[3], updated_at: values[4] })
                return { meta: { changes: 1 } }
            }
            if (sql.includes('INSERT INTO ai_action_proposals')) {
                this.proposals.push({ id: values[0], user_id: values[1], tool_name: values[2], action: values[3], bookmark_id: values[4], collection_id: values[5], payload: values[6], status: 'pending', result: null, error_code: null, error_message: null, created_at: values.at(-2), updated_at: values.at(-1), decided_at: null })
                return { meta: { changes: 1 } }
            }
            if (sql.includes('INSERT INTO ai_standing_approvals')) {
                const existing = this.standingApprovals.find(item => item.user_id === values[1] && item.tool_name === values[2] && item.collection_id === values[3])
                if (existing) return { meta: { changes: 0 } }
                this.standingApprovals.push({ id: values[0], user_id: values[1], tool_name: values[2], collection_id: values[3], created_at: values[4], updated_at: values[5], revoked_at: null })
                return { meta: { changes: 1 } }
            }
            if (sql.includes('INSERT INTO ai_providers')) {
                const [userId, endpoint, model, encryptedApiKey, reasoningMode, verifiedAt, createdAt, updatedAt] = values
                const existing = this.providers.find(item => item.user_id === userId)
                if (existing) Object.assign(existing, { endpoint, model, encrypted_api_key: encryptedApiKey, reasoning_mode: reasoningMode, verified_at: verifiedAt, updated_at: updatedAt })
                else this.providers.push({ user_id: userId, endpoint, model, encrypted_api_key: encryptedApiKey, reasoning_mode: reasoningMode, verified_at: verifiedAt, created_at: createdAt, updated_at: updatedAt })
                return { meta: { changes: 1 } }
            }
            if (sql.includes('UPDATE ai_action_proposals SET status = \'processing\'')) {
                const row = this.proposals.find(item => item.id === values[1] && item.user_id === values[2] && item.status === 'pending')
                if (row) { row.status = 'processing'; row.updated_at = values[0] }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE ai_action_proposals SET status = \'applied\'')) {
                const row = this.proposals.find(item => item.id === values[3] && item.user_id === values[4])
                if (row) { row.status = 'applied'; row.result = values[0]; row.updated_at = values[1]; row.decided_at = values[2] }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE ai_action_proposals SET status = \'failed\'')) {
                const row = this.proposals.find(item => item.id === values[4] && item.user_id === values[5])
                if (row) { row.status = 'failed'; row.error_code = values[0]; row.error_message = values[1]; row.updated_at = values[2]; row.decided_at = values[3] }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE ai_action_proposals SET status = \'rejected\'')) {
                const row = this.proposals.find(item => item.id === values[2] && item.user_id === values[3])
                if (row) { row.status = 'rejected'; row.updated_at = values[0]; row.decided_at = values[1] }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE ai_standing_approvals SET revoked_at = NULL')) {
                const row = this.standingApprovals.find(item => item.id === values[1] && item.user_id === values[2])
                if (row) { row.revoked_at = null; row.updated_at = values[0] }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE ai_standing_approvals SET revoked_at = ?')) {
                const row = this.standingApprovals.find(item => item.id === values[2] && item.user_id === values[3])
                if (row) { row.revoked_at = values[0]; row.updated_at = values[1] }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE bookmarks SET url = ?')) {
                const row = this.bookmarks.find(item => item.id === values[12] && item.user_id === values[13])
                if (row) {
                    Object.assign(row, { url: values[0], title: values[1], description: values[2], note: values[3], cover: values[4], media: values[5], collection_id: values[6], tags: values[7], highlights: values[8], removed_at: values[9], removed_batch: values[10], updated_at: values[11] })
                }
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('UPDATE bookmarks SET removed_at = ?')) {
                const row = this.bookmarks.find(item => item.id === values[3] && item.user_id === values[4])
                if (row) Object.assign(row, { removed_at: values[0], removed_batch: values[1], updated_at: values[2] })
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('INSERT INTO ai_messages')) {
                this.messages.push({ id: this.nextMessageId++, chat_id: values[0], user_id: values[1], role: values[2], content: values[3], created_at: values[4] })
                return { meta: { changes: 1 } }
            }
            if (sql.includes('UPDATE ai_chats')) {
                const row = this.chats.find(item => item.id === values[1] && item.user_id === values[2])
                if (row) row.updated_at = values[0]
                return { meta: { changes: row ? 1 : 0 } }
            }
            if (sql.includes('DELETE FROM ai_messages')) {
                const before = this.messages.length
                if (sql.includes('chat_id = ?')) this.messages = this.messages.filter(item => !(item.chat_id === values[0] && item.user_id === values[1]))
                else this.messages = this.messages.filter(item => item.user_id !== values[0])
                return { meta: { changes: before - this.messages.length } }
            }
            if (sql.includes('DELETE FROM ai_chats')) {
                const before = this.chats.length
                if (sql.includes(' WHERE id = ?')) this.chats = this.chats.filter(item => !(item.id === values[0] && item.user_id === values[1]))
                else this.chats = this.chats.filter(item => item.user_id !== values[0])
                return { meta: { changes: before - this.chats.length } }
            }
            if (sql.includes('DELETE FROM ai_providers')) {
                const before = this.providers.length
                this.providers = this.providers.filter(item => item.user_id !== values[0])
                return { meta: { changes: before - this.providers.length } }
            }
            if (sql.includes('INSERT INTO alerts')) {
                this.alerts.push({ kind: values[2], severity: values[3], route: values[4], metadata: values[6] })
                return { meta: { changes: 1 } }
            }
            return { meta: { changes: 1 } }
        }
        return { bind: (...next) => { values = next; return { first, all, run } } }
    }

    async batch(statements) {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        return results
    }
}

const request = (path, options = {}) => new Request('https://api.example.test' + path, {
    ...options,
    headers: { Cookie: 'rd_session=one', 'Content-Type': 'application/json', ...(options.headers || {}) }
})

const environment = async () => {
    const db = new AiDatabase('ai-secret')
    await db.addSession('one', 1)
    await db.addSession('two', 2)
    const calls = []
    return {
        env: {
            DB: db,
            SESSION_SECRET: 'ai-secret',
            APP_ORIGIN: 'https://app.example.test',
            AI_PAGE_ORIGIN: 'https://ai.example.test/ai',
            CORS_ORIGINS: 'https://app.example.test',
            AI_MODEL: '@cf/test-model',
            AI: {
                run: async (...args) => {
                    calls.push(args)
                    return new Response('data: {"response":"Hello"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
                }
            }
        },
        db,
        calls
    }
}

test('AI config, streaming chat, private history, and deletion use Cloudflare-managed capacity', async () => {
    const { env, db, calls } = await environment()
    env.AI_DAILY_QUOTA = '0'
    env.AI_GLOBAL_DAILY_QUOTA = '0'
    const config = await worker.fetch(request('/v2/ai/config', { headers: { Origin: 'https://ai.example.test' } }), env)
    assert.equal(config.status, 200)
    assert.equal(config.headers.get('Access-Control-Allow-Origin'), 'https://ai.example.test')
    const configBody = await config.json()
    assert.equal(configBody.quota.managedBy, 'cloudflare')
    assert.match(configBody.prompts.collection.prompt, /existing Collection/i)
    assert.match(configBody.prompts.tags.prompt, /high-value terms/i)
    assert.match(configBody.prompts.note.prompt, /high-value note/i)
    const quota = await worker.fetch(request('/v2/ai/quota'), env)
    assert.equal(quota.status, 200)
    assert.equal((await quota.json()).quota.managedBy, 'cloudflare')

    const stream = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Hello AI' }) }), env)
    assert.equal(stream.status, 200)
    const text = await stream.text()
    assert.match(text, /"delta":"Hello"/)
    assert.match(text, /"done":true/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], '@cf/test-model')
    assert.equal(calls[0][1].stream, true)
    assert.equal(calls[0][1].messages.at(-1).content, 'Hello AI')

    const history = await worker.fetch(request('/v2/ai/history'), env)
    const chat = (await history.json()).items[0]
    assert.equal(chat.messages.length, 2)
    assert.deepEqual(chat.messages.map(item => item.role), ['user', 'assistant'])

    const second = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ chatId: chat.id, message: 'Again' }) }), env)
    assert.equal(second.status, 200)
    assert.match(await second.text(), /"done":true/)
    assert.equal(calls.length, 2)

    const otherHistory = await worker.fetch(request('/v2/ai/history', { headers: { Cookie: 'rd_session=two' } }), env)
    assert.deepEqual((await otherHistory.json()).items, [])
    const forbiddenDelete = await worker.fetch(request('/v2/ai/chats/' + encodeURIComponent(chat.id), { method: 'DELETE', headers: { Cookie: 'rd_session=two' } }), env)
    assert.equal(forbiddenDelete.status, 404)

    const deletedChat = await worker.fetch(request('/v2/ai/chats/' + encodeURIComponent(chat.id), { method: 'DELETE' }), env)
    assert.equal(deletedChat.status, 200)

    const deleted = await worker.fetch(request('/v2/ai/history', { method: 'DELETE' }), env)
    assert.equal(deleted.status, 200)
    const afterDelete = await worker.fetch(request('/v2/ai/history'), env)
    assert.deepEqual((await afterDelete.json()).items, [])
    assert.equal(db.chats.length, 0)
    assert.equal(db.messages.length, 0)
})

test('AI greetings do not trigger bookmark tools and still return a response', async () => {
    const { env, calls } = await environment()
    env.AI.run = async (...args) => {
        calls.push(args)
        return args[1].tools?.length
            ? new Response('data: {"tool_calls":[{"name":"bookmark_read","arguments":{}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
            : new Response('data: {"response":"你好！"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }

    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: '你好', language: 'zh-CN' }) }), env)
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /"delta":"你好！"/)
    assert.match(body, /"done":true/)
    assert.equal(calls[0][1].tools, undefined)
})

test('AI chat reports an empty provider response instead of silently completing', async () => {
    const { env } = await environment()
    env.AI.run = async () => new Response('data: {"response":""}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })

    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Return nothing' }) }), env)
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /"error":"ai_provider_empty_response"/)
    assert.doesNotMatch(body, /"done":true/)
})

test('AI prompt optimization returns a preview without saving user configuration', async () => {
    const { env, db, calls } = await environment()
    db.users[0].config = { ai_collection_prompt: 'Prefer existing collections.' }
    env.AI.run = async (...args) => {
        calls.push(args)
        const response = JSON.stringify({ prompt: 'Prefer one durable existing Collection and explain no alternatives.', summary: 'Clarified priority and fallback behavior.' })
        return new Response(`data: ${JSON.stringify({ response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }

    const response = await worker.fetch(request('/v2/ai/prompt-optimize', {
        method: 'POST',
        body: JSON.stringify({ field: 'collection', prompt: 'Prefer existing collections.', language: 'en' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.field, 'collection')
    assert.equal(body.prompt, 'Prefer one durable existing Collection and explain no alternatives.')
    assert.equal(body.summary, 'Clarified priority and fallback behavior.')
    assert.equal(calls.length, 1)
    assert.match(calls[0][1].messages[0].content, /Collection classification/)
    assert.match(calls[0][1].messages[1].content, /Prefer existing collections/)
    assert.equal(db.users[0].config.ai_collection_prompt, 'Prefer existing collections.')
})

test('AI prompt optimization validates field and length before invoking a provider', async () => {
    const { env, calls } = await environment()
    const invalidField = await worker.fetch(request('/v2/ai/prompt-optimize', {
        method: 'POST',
        body: JSON.stringify({ field: 'unknown', prompt: 'Prompt' })
    }), env)
    assert.equal(invalidField.status, 400)
    const tooLong = await worker.fetch(request('/v2/ai/prompt-optimize', {
        method: 'POST',
        body: JSON.stringify({ field: 'tags', prompt: 'x'.repeat(2001) })
    }), env)
    assert.equal(tooLong.status, 400)
    assert.equal(calls.length, 0)
})

test('AI grounds natural-language prompts in authorized bookmark search results', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 7,
        user_id: 1,
        url: 'https://developers.cloudflare.com/workers-ai/',
        title: 'Cloudflare Workers AI',
        description: 'AI engineering documentation',
        note: '',
        highlights: '[]',
        tags: '["cloudflare"]'
    })
    const response = await worker.fetch(request('/v2/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Find Cloudflare bookmarks' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /"raindropId":7/)
    assert.match(calls[0][1].messages.at(-1).content, /Cloudflare Workers AI/)
    assert.match(calls[0][1].messages.at(-1).content, /Tags: cloudflare/)
})

test('AI provider failures are explicit and do not invoke a fallback', async () => {
    const { env, calls } = await environment()
    env.AI.run = async (...args) => { calls.push(args); throw new Error('provider down') }
    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Try once' }) }), env)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error, 'ai_provider_unavailable')
    assert.equal(calls.length, 1)
})

test('Custom AI Provider validates public HTTPS endpoints and keeps probes metadata-free', async () => {
    const { env, db } = await environment()
    const privateEndpoint = await worker.fetch(request('/v2/ai/provider/test', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'http://127.0.0.1/v1', model: 'custom-model', apiKey: 'secret-key' })
    }), env)
    assert.equal(privateEndpoint.status, 400)
    assert.equal((await privateEndpoint.json()).error, 'ai_provider_endpoint_invalid')

    const calls = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url, options = {}) => {
        const body = JSON.parse(options.body || '{}')
        calls.push({ url: String(url), body, headers: options.headers })
        if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Custom hello"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
        return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    try {
        const saved = await worker.fetch(request('/v2/ai/provider', {
            method: 'PUT',
            body: JSON.stringify({ endpoint: 'https://provider.example.test/v1', model: 'custom-model', apiKey: 'secret-key' })
        }), env)
        assert.equal(saved.status, 200)
        const savedBody = await saved.json()
        assert.equal(savedBody.custom.configured, true)
        assert.equal(savedBody.custom.endpoint, 'https://provider.example.test/v1/chat/completions')
        assert.equal(db.providers.length, 1)
        assert.doesNotMatch(db.providers[0].encrypted_api_key, /secret-key/)
        assert.equal(calls[0].body.messages[0].content, 'Reply with OK only.')
        assert.doesNotMatch(JSON.stringify(calls[0].body), /Bookmark|bookmark|Highlights|attachment/i)

        const config = await worker.fetch(request('/v2/ai/config'), env)
        const configBody = await config.json()
        assert.equal(configBody.custom.configured, true)
        assert.equal(Object.hasOwn(configBody.custom, 'apiKey'), false)

        const chat = await worker.fetch(request('/v2/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ provider: 'custom', message: 'Hello custom' })
        }), env)
        assert.equal(chat.status, 200)
        const stream = await chat.text()
        assert.match(stream, /"provider":"custom"/)
        assert.match(stream, /Custom hello/)
        assert.equal(calls[1].body.model, 'custom-model')
        assert.ok(calls[1].body.tools.every(item => item.type === 'function'))

        const note = await worker.fetch(request('/v2/ai/description-draft', {
            method: 'POST',
            body: JSON.stringify({
                provider: 'custom',
                link: 'https://example.test/note',
                title: 'Custom note',
                field: 'note',
                thinking: true
            })
        }), env)
        assert.equal(note.status, 200)
        assert.equal(calls[2].body.reasoning_effort, 'medium')

        const optimizedPrompt = JSON.stringify({ prompt: 'Use two concise technology Tags.', summary: 'Reduced the Tag count and clarified specificity.' })
        globalThis.fetch = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: optimizedPrompt } }] })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
        const optimized = await worker.fetch(request('/v2/ai/prompt-optimize', {
            method: 'POST',
            body: JSON.stringify({ provider: 'custom', field: 'tags', prompt: 'Use Tags.' })
        }), env)
        assert.equal(optimized.status, 200)
        assert.equal((await optimized.json()).prompt, 'Use two concise technology Tags.')

        globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"not valid JSON"}}]}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
        const malformedSuggestions = await worker.fetch(request('/v2/ai/suggestions', {
            method: 'POST',
            body: JSON.stringify({ provider: 'custom', link: 'https://example.test/malformed', title: 'Malformed suggestions' })
        }), env)
        assert.equal(malformedSuggestions.status, 502)
        const malformedBody = await malformedSuggestions.json()
        assert.equal(malformedBody.error, 'ai_provider_invalid_response')
        assert.equal(malformedBody.provider, 'custom')
        assert.deepEqual(malformedBody.fallbackProviders, ['workers_ai'])

        globalThis.fetch = async () => { throw new Error('provider down') }
        const failed = await worker.fetch(request('/v2/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ provider: 'custom', message: 'Try custom again' })
        }), env)
        assert.equal(failed.status, 503)
        const failedBody = await failed.json()
        assert.equal(failedBody.provider, 'custom')
        assert.deepEqual(failedBody.fallbackProviders, ['workers_ai'])

        const deleted = await worker.fetch(request('/v2/ai/provider', { method: 'DELETE' }), env)
        assert.equal(deleted.status, 200)
        assert.equal((await deleted.json()).deleted, true)
        assert.deepEqual(db.providers, [])
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('Custom AI Provider rejects unsafe redirects without sending credentials onward', async () => {
    const { env } = await environment()
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } })
    }
    try {
        const response = await worker.fetch(request('/v2/ai/provider/test', {
            method: 'POST',
            body: JSON.stringify({ endpoint: 'https://provider.example.test/v1', model: 'custom-model', apiKey: 'secret-key' })
        }), env)
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error, 'ai_provider_redirect_invalid')
        assert.equal(calls, 1)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('AI accepts a Workers AI ReadableStream binding result', async () => {
    const { env } = await environment()
    env.AI.run = async () => new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"streamed"}\n\n'))
            controller.close()
        }
    })
    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Stream this' }) }), env)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /"delta":"streamed"/)
})

test('AI forwards confirmed tool-called events without changing the provider', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 7,
        user_id: 1,
        url: 'https://example.test/tool',
        title: 'Tool bookmark',
        description: '',
        note: '',
        highlights: '[]'
    })
    env.AI.run = async () => new Response('data: {"toolCalled":{"name":"bookmark_refresh","raindropId":7}}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })
    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Find Tool bookmark' }) }), env)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /"toolCalled":\{"name":"bookmark_refresh","raindropId":7\}/)
})

test('AI suggestions stay authorized, language-aware, and metadata-only', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 7,
        user_id: 1,
        url: 'https://developers.cloudflare.com/workers-ai/',
        title: 'Cloudflare Workers AI',
        description: 'AI engineering documentation',
        note: 'Keep this note',
        highlights: '[]',
        tags: '["existing"]'
    })
    db.bookmarks.push({ id: 8, user_id: 1, url: 'https://example.test/other', title: 'Other bookmark', description: '', note: '', highlights: '[]', tags: '["cloudflare"]' })
    db.collections.push({ id: 3, user_id: 1, title: 'Engineering', parent_id: null })
    db.collections.push({ id: 4, user_id: 2, title: 'Other user collection', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"response":"{\\"collections\\":[{\\"$id\\":3}],\\"tags\\":[\\"cloudflare\\"],\\"new_tags\\":[\\"workers\\"],\\"new_collections\\":[\\"AI Projects\\"]}"}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 7, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [3])
    assert.deepEqual(body.suggestions.tags, ['cloudflare'])
    assert.deepEqual(body.suggestions.newTags, ['workers'])
    assert.deepEqual(body.suggestions.newCollections, [])
    assert.equal(Object.hasOwn(body, 'item'), false)
    assert.equal(body.language, 'zh-Hans')
    assert.equal(calls[0][1].stream, false)
    assert.deepEqual(calls[0][1].response_format, { type: 'json_object' })
    assert.match(calls[0][1].messages[0].content, /zh-Hans/)
    assert.match(calls[0][1].messages.at(-1).content, /Cloudflare Workers AI/)
    assert.match(calls[0][1].messages.at(-1).content, /"tags":\["existing"\]/)
    assert.doesNotMatch(calls[0][1].messages.at(-1).content, /Other user collection/)
    assert.doesNotMatch(calls[0][1].messages.at(-1).content, /attachment-body|snapshot-body/)
})

test('AI collection suggestions prioritize ranked existing candidates over new titles', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 7,
        user_id: 1,
        url: 'https://example.test/ai',
        title: 'AI bookmark',
        description: 'Engineering research notes',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 3, user_id: 1, title: 'Engineering', parent_id: null })
    db.collections.push({ id: 5, user_id: 1, title: 'AI Projects', parent_id: null })
    db.collections.push({ id: 4, user_id: 2, title: 'Other user collection', parent_id: null })
    env.AI.run = async () => new Response('data: {"response":"{\\"collections\\":[{\\"id\\":3,\\"confidence\\":0.92,\\"reason\\":\\"Matches the bookmark topic.\\"},{\\"id\\":3,\\"confidence\\":0.4},{\\"id\\":4,\\"confidence\\":0.99}],\\"new_collections\\":[{\\"title\\":\\"AI Projects\\",\\"confidence\\":0.9},{\\"title\\":\\"AI Project\\",\\"confidence\\":0.8},{\\"title\\":\\"Research\\",\\"confidence\\":\\"medium\\"},{\\"title\\":\\"Test collection\\",\\"confidence\\":0.9}]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 7 })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [3])
    assert.equal(body.suggestions.collections[0].confidence, 0.92)
    assert.equal(body.suggestions.collections[0].confidenceTier, 'high')
    assert.deepEqual(body.suggestions.newCollections, [])
    assert.deepEqual(body.suggestions.newCollectionDetails, [])
    assert.deepEqual(body.suggestions.collectionRecommendations.map(item => item.kind), ['existing'])
})

test('AI collection suggestions use stable top-level categories and nested children', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 23,
        user_id: 1,
        url: 'https://example.test/tokyo',
        title: '东京自由行',
        description: '日本浅草和镰仓行程',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 30, user_id: 1, title: '旅行与地点', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"response":"{\\"new_collections\\":[{\\"title\\":\\"日本\\",\\"category\\":\\"旅行与地点\\",\\"parentId\\":30},{\\"title\\":\\"东京攻略\\",\\"category\\":\\"旅行与地点\\"}],\\"new_tags\\":[\\"浅草\\"]}"}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 23, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.newCollections, ['日本', '东京攻略'])
    assert.deepEqual(body.suggestions.newCollectionDetails.map(item => item.category), ['旅行与地点', '旅行与地点'])
    assert.deepEqual(body.suggestions.newCollectionDetails.map(item => item.parentId), [30, 30])
    assert.deepEqual(body.suggestions.collectionCategories, [
        '技术与开发', '工作与项目', '学习与研究', '生活与实用',
        '旅行与地点', '内容与阅读', '媒体与娱乐', '待整理'
    ])
    assert.match(calls[0][1].messages[0].content, /旅行与地点/)
    assert.match(calls[0][1].messages[0].content, /one to three concise new child Collections/)
})

test('AI collection suggestions keep an existing parent and recommend a new child', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 24,
        user_id: 1,
        url: 'https://oil-oil.github.io/selector/',
        title: 'Selector — 可视化元素选择器',
        description: '用于生成 CSS 选择器，帮助开发者快速准确地选择网页元素。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 31, user_id: 1, title: '技术与开发', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify({
            collections: [{ id: 31, confidence: 0.92, reason: 'The bookmark is a frontend development tool.' }],
            new_collections: [{ title: '前端', category: '技术与开发', parentId: 31, confidence: 0.9, reason: 'CSS and web element selection indicate frontend work.' }],
            new_tags: ['CSS']
        }) })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 24, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [31])
    assert.deepEqual(body.suggestions.newCollections, ['前端'])
    assert.equal(body.suggestions.newCollectionDetails[0].parentId, 31)
    assert.deepEqual(body.suggestions.collectionRecommendations.map(item => item.title), ['前端', '技术与开发'])
    assert.equal(body.suggestionSource, 'model')
    assert.match(calls[0][1].messages[0].content, /existing top-level Collection is a reasonable fit/)
})

test('AI collection suggestions add a frontend child fallback below an existing parent', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 25,
        user_id: 1,
        url: 'https://oil-oil.github.io/selector/',
        title: 'Selector — 可视化元素选择器',
        description: '用于生成 CSS 选择器，帮助开发者快速准确地选择网页元素。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 31, user_id: 1, title: '技术与开发', parent_id: null })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [{ id: 31, confidence: 0.92, reason: 'The bookmark is technical.' }],
        new_tags: ['CSS']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 25, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [31])
    assert.deepEqual(body.suggestions.newCollections, ['前端'])
    assert.equal(body.suggestions.newCollectionDetails[0].parentId, 31)
    assert.equal(body.suggestionSource, 'fallback')
})

test('AI collection suggestions prefer an existing child over a duplicate new child', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 26,
        user_id: 1,
        url: 'https://oil-oil.github.io/selector/',
        title: 'Selector — 可视化元素选择器',
        description: '用于生成 CSS 选择器，帮助开发者快速准确地选择网页元素。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push(
        { id: 31, user_id: 1, title: '技术与开发', parent_id: null },
        { id: 32, user_id: 1, title: '前端', parent_id: 31 }
    )
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [{ id: 32, confidence: 0.94, reason: 'An existing frontend child matches.' }],
        new_collections: [{ title: '前端', category: '技术与开发', parentId: 31, confidence: 0.9 }],
        new_tags: ['CSS']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 26, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [32])
    assert.deepEqual(body.suggestions.newCollectionDetails, [])
    assert.deepEqual(body.suggestions.collectionRecommendations.map(item => item.id), [32])
})

test('AI collection suggestions offer up to three new categories when no existing collection fits', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 231,
        user_id: 1,
        url: 'https://www.bbc.com/news',
        title: 'BBC News',
        description: 'BBC 新闻主页，提供国际、商业、科技、文化和地区新闻。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        new_collections: [
            { title: '新闻与时事', category: '内容与阅读', confidence: 0.9 },
            { title: '国际新闻', category: '内容与阅读', confidence: 0.85 },
            { title: '商业新闻', category: '内容与阅读', confidence: 0.8 },
            { title: '科技新闻', category: '内容与阅读', confidence: 0.75 }
        ],
        new_tags: ['BBC']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 231, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'suggestions')
    assert.deepEqual(body.suggestions.newCollections, ['新闻与时事', '国际新闻', '商业新闻'])
    assert.deepEqual(body.suggestions.createSuggestions.map(item => item.title), ['新闻与时事', '国际新闻', '商业新闻'])
    assert.deepEqual(body.suggestions.collectionRecommendations.map(item => item.kind), ['new', 'new', 'new'])
})

test('AI collection suggestions fall back to news categories when the model has no match', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 232,
        user_id: 1,
        url: 'https://www.bbc.com/news',
        title: 'BBC News',
        description: 'BBC 新闻主页，提供国际、商业、科技、文化和地区新闻。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{\\"status\\":\\"no_match\\",\\"collections\\":[],\\"tags\\":[],\\"new_tags\\":[],\\"new_collections\\":[]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 232, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'fallback')
    assert.deepEqual(body.suggestions.newCollections, ['新闻与时事', '国际新闻', '商业新闻'])
    assert.deepEqual(body.suggestions.newCollectionDetails.map(item => item.category), ['内容与阅读', '内容与阅读', '内容与阅读'])
    assert.deepEqual(body.suggestions.collectionRecommendations.map(item => item.kind), ['new', 'new', 'new'])
})

test('AI suggestions classify a GitHub music app without sentence-fragment tags', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 61,
        user_id: 1,
        url: 'https://github.com/lyswhut/lx-music-desktop',
        title: 'lyswhut/lx-music-desktop: 一个基于 Electron 的音乐软件',
        description: '一个基于 Electron 的音乐软件，支持自定义，用于听和管理音乐。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 31, user_id: 1, title: '技术与开发', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify({
            collections: [],
            tags: [
                { tag: '一个基于', confidence: 0.9 },
                { tag: '的音乐软件', confidence: 0.9 },
                { tag: '适合使用', confidence: 0.9 },
                { tag: '用于学习', confidence: 0.9 },
                { tag: 'Electron', confidence: 0.9 },
                { tag: '桌面应用', confidence: 0.8 },
                { tag: '跨平台', confidence: 0.8 },
                { tag: '音乐播放器', confidence: 0.8 },
                { tag: 'GitHub', confidence: 0.7 }
            ],
            new_tags: ['lx-music-desktop']
        }) })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 61, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.newCollections, ['开源项目'])
    assert.equal(body.suggestions.newCollectionDetails[0].category, '技术与开发')
    assert.equal(body.suggestions.newCollectionDetails[0].parentId, 31)
    assert.ok(body.suggestions.newTags.includes('Electron'))
    assert.ok(body.suggestions.newTags.includes('桌面应用'))
    assert.ok(body.suggestions.newTags.includes('跨平台'))
    assert.ok(!body.suggestions.newTags.includes('一个基于'))
    assert.ok(!body.suggestions.newTags.includes('的音乐软件'))
    assert.ok(!body.suggestions.newTags.includes('适合使用'))
    assert.ok(!body.suggestions.newTags.includes('用于学习'))
    assert.deepEqual(body.suggestions.newTags, ['Electron', '桌面应用', '跨平台', '音乐播放器', 'GitHub 项目'])
    assert.match(calls[0][1].messages[0].content, /Do not use a host or URL fragment as a tag unless it improves future retrieval/)
})

test('AI no-match still offers one confirmed new collection for a durable topic', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 601,
        user_id: 1,
        url: 'https://github.com/lyswhut/lx-music-desktop',
        title: 'lyswhut/lx-music-desktop: 一个基于 Electron 的音乐软件',
        description: '一个基于 Electron 的音乐软件，支持自定义和多平台运行，用于听和管理音乐。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        status: 'no_match',
        collections: [],
        tags: ['一个基于', '的音乐软件', 'Electron', '桌面应用', '跨平台', '音乐播放器'],
        new_tags: ['GitHub']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 601, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'fallback')
    assert.deepEqual(body.suggestions.newCollections, ['开源项目'])
    assert.deepEqual(body.suggestions.createSuggestions.map(item => item.title), ['开源项目'])
    assert.ok(!body.suggestions.newTags.includes('一个基于'))
    assert.ok(!body.suggestions.newTags.includes('的音乐软件'))
    assert.ok(body.suggestions.newTags.includes('Electron'))
    assert.ok(body.suggestions.newTags.includes('跨平台'))
})

test('AI does not force a code repository into a media collection', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 606,
        user_id: 1,
        url: 'https://github.com/lyswhut/lx-music-desktop',
        title: 'lyswhut/lx-music-desktop: 一个基于 Electron 的音乐软件',
        description: '一个基于 Electron 的音乐软件，支持自定义和多平台运行，用于听和管理音乐。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 36, user_id: 1, title: '媒体与直播', parent_id: null })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [{ id: 36, confidence: 0.99, reason: 'The bookmark mentions music.' }],
        tags: ['Electron', '音乐软件']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 606, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.newCollections, ['开源项目'])
    assert.ok(body.suggestions.newTags.includes('音乐播放器'))
})

test('AI suggestion tags normalize aliases and keep platform metadata optional', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 602,
        user_id: 1,
        url: 'https://www.bilibili.com/',
        title: '哔哩哔哩 bilibili',
        description: '中国视频分享平台，提供中文内容和内容社区。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        new_tags: ['视频', '媒体', '中文', '视频分享平台', 'bilibili', '内容社区']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 602, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(body.suggestions.newTags.includes('中文内容'))
    assert.ok(body.suggestions.newTags.includes('视频平台'))
    assert.ok(body.suggestions.newTags.includes('内容社区'))
    assert.ok(body.suggestions.newTags.includes('Bilibili'))
    assert.ok(!body.suggestions.newTags.includes('视频'))
    assert.ok(!body.suggestions.newTags.includes('媒体'))
})

test('AI collection matching includes the user collection history', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push(
        {
            id: 603,
            user_id: 1,
            collection_id: -1,
            url: 'https://example.test/lx',
            title: 'Electron music player',
            description: 'A desktop music app built with Electron.',
            note: '',
            highlights: '[]',
            tags: '[]'
        },
        {
            id: 604,
            user_id: 1,
            collection_id: 33,
            url: 'https://example.test/music-app',
            title: 'Desktop music app',
            description: 'Electron music player for the desktop.',
            note: '',
            highlights: '[]',
            tags: '["Electron","音乐播放器"]'
        }
    )
    db.collections.push({ id: 33, user_id: 1, title: '我的收藏', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify({
            collections: [{ id: 33, confidence: 0.9, reason: 'Matches the user collection history.' }],
            new_tags: ['Electron']
        }) })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 603, language: 'en' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [33])
    assert.equal(Object.hasOwn(body.suggestions.collections[0], 'history'), false)
    assert.match(calls[0][1].messages.at(-1).content, /Desktop music app/)
    assert.match(calls[0][1].messages.at(-1).content, /"history"/)
})

test('AI classifies a specific Bilibili video by subject, not by platform', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 605,
        user_id: 1,
        url: 'https://www.bilibili.com/video/BV1example',
        title: 'Transformer 论文解读',
        description: '讲解 Transformer、深度学习和注意力机制。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push(
        { id: 34, user_id: 1, title: '媒体与直播', parent_id: null },
        { id: 35, user_id: 1, title: '学习与研究', parent_id: null }
    )
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [
            { id: 34, confidence: 0.98, reason: 'It is hosted on Bilibili.' },
            { id: 35, confidence: 0.9, reason: 'It explains a research topic.' }
        ],
        new_tags: ['Transformer', '论文解读', '深度学习', '中文', 'Bilibili']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 605, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [35])
    assert.ok(body.suggestions.newTags.includes('Transformer'))
    assert.ok(body.suggestions.newTags.includes('深度学习'))
    assert.ok(body.suggestions.newTags.includes('中文内容'))
    assert.ok(!body.suggestions.newTags.includes('Bilibili'))
})

test('AI suggestions keep a video platform collection while removing generic media tags', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 63,
        user_id: 1,
        url: 'https://www.bilibili.com/',
        title: '哔哩哔哩 bilibili',
        description: '中国视频分享平台，包含动画、影视、知识、生活和科技等多种内容。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 32, user_id: 1, title: '媒体与直播', parent_id: null })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [{ id: 32, confidence: 0.9, reason: '视频平台入口适合媒体收藏。' }],
        new_tags: ['视频', '媒体', '中文', '视频平台', '中文内容', '内容社区', 'Bilibili']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 63, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [32])
    assert.ok(body.suggestions.newTags.includes('视频平台'))
    assert.ok(body.suggestions.newTags.includes('中文内容'))
    assert.ok(body.suggestions.newTags.includes('内容社区'))
    assert.ok(body.suggestions.newTags.includes('Bilibili'))
    assert.ok(!body.suggestions.newTags.includes('视频'))
    assert.ok(!body.suggestions.newTags.includes('媒体'))
})

test('AI suggestions keep collection and tag responsibilities separate for a medical bookmark', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 62,
        user_id: 1,
        url: 'https://www.nature.com/articles/s41586-020-2649-2',
        title: 'A 2019-nCoV vaccine candidate | Nature',
        description: 'Nature 研究文章，介绍针对新型冠状病毒的疫苗候选方案和实验结果。',
        note: '',
        highlights: '[]',
        tags: '["文章","科学","研究"]'
    })
    db.collections.push({ id: 3, user_id: 1, title: 'AI 与研究', parent_id: null })
    db.collections.push({ id: 4, user_id: 1, title: '媒体与直播', parent_id: null })
    const model = {
        collections: [],
        tags: ['文章', '研究', '新型冠状病毒', '疫苗'],
        new_tags: ['冠状病毒', 'Nature', '疫苗研究'],
        new_collections: []
    }
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify(model) })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 62, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'fallback')
    assert.equal(body.suggestionSource, 'fallback')
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(new Set(body.suggestions.newTags), new Set(['疫苗', '新型冠状病毒', 'Nature']))
    assert.equal(body.suggestions.newTags.length, 3)
    assert.equal(calls.length, 1)
    assert.deepEqual(body.suggestions.createSuggestions.map(item => item.title), ['医学与生命科学'])
    assert.deepEqual(body.item, undefined)
    assert.match(calls[0][1].messages[0].content, /Collections answer where the Bookmark belongs/)
    assert.match(calls[0][1].messages[0].content, /Tags answer which concrete terms/)
    assert.match(calls[0][1].messages[0].content, /never return status, no_match, or prose fields/)
    assert.match(calls[0][1].messages[0].content, /at most six total suggestions/)
})

test('AI suggestions retry an empty tag result once and keep the retry output', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 64,
        user_id: 1,
        url: 'https://example.test/selector-tool',
        title: 'Selector tool',
        description: 'A visual selector tool for developers.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    let attempt = 0
    env.AI.run = async (...args) => {
        calls.push(args)
        const response = attempt++ ? { new_tags: ['selector-tool'] } : { tags: [], new_tags: [] }
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify(response) })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 64, language: 'en' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(calls.length, 2)
    assert.deepEqual(body.suggestions.newTags, ['selector-tool'])
    assert.equal(body.suggestionStatus, 'fallback')
})

test('AI suggestions use title fallback after an explicitly empty tag result', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 65,
        user_id: 1,
        url: 'https://example.test/selector',
        title: 'Selector tool',
        description: 'A visual element selector.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"response":"{\\"status\\":\\"no_match\\",\\"tags\\":[],\\"new_tags\\":[]}"}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 65, language: 'en' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(calls.length, 1)
    assert.equal(body.suggestionSource, 'fallback')
    assert.ok(body.suggestions.newTags.includes('Selector'))
})

test('AI suggestions filter generic media tags and classify protocol collections as technical', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 66,
        user_id: 1,
        url: 'https://www.rfc-editor.org/rfc/rfc9110',
        title: 'HTTP 网络协议',
        description: 'HTTP 网络协议语义与 Web 请求规范。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 3, user_id: 1, title: '技术与开发', parent_id: null })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        new_tags: ['视频分享', '视频', '媒体', '动画', '用于生成', '用于验证', '架构论文页面', '真实机器学习论文'],
        new_collections: [{ title: 'HTTP 网络协议' }]
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 66, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(!body.suggestions.newTags.includes('视频分享'))
    assert.ok(!body.suggestions.newTags.includes('视频'))
    assert.ok(!body.suggestions.newTags.includes('用于生成'))
    assert.ok(!body.suggestions.newTags.includes('用于验证'))
    assert.ok(!body.suggestions.newTags.includes('架构论文页面'))
    assert.ok(!body.suggestions.newTags.includes('真实机器学习论文'))
    assert.equal(body.suggestions.newCollectionDetails[0].category, '技术与开发')
    assert.equal(body.suggestions.newCollectionDetails[0].parentId, 3)
})

test('AI fallback tags prefer title tokens over short domain fragments', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 68,
        user_id: 1,
        url: 'https://oil-oil.github.io/selector',
        title: 'Selector tool',
        description: 'A visual element selector.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{\\"tags\\":[],\\"new_tags\\":[]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 68, language: 'en' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(body.suggestions.newTags.includes('Selector'))
    assert.ok(!body.suggestions.newTags.includes('oil'))
})

test('AI suggestions drop UI metadata terms even when they appear in the Bookmark note', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 69,
        user_id: 1,
        url: 'https://example.test/attention',
        title: 'Attention Is All You Need',
        description: 'A machine learning paper.',
        note: '用于验证集合、论文标签和封面元数据。',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        new_tags: ['集合', '论文标签', '封面元数据', 'Attention']
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 69, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.newTags, ['Attention'])
})

test('AI suggestions treat a conflicting note as user context, not bookmark topic', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 70,
        user_id: 1,
        url: 'https://react.dev/reference/rsc',
        title: 'React Server Components',
        description: 'React 官方文档，介绍 Server Components 与渲染机制。',
        note: '这是媒体与直播收藏集里的东京自由行攻略，包含美食和直播源。',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 4, user_id: 1, title: '媒体与直播', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [{ id: 4, confidence: 0.95, reason: 'Matches the note.' }],
        new_tags: ['React', '自由行', '美食', '直播'],
        new_collections: [{ title: '东京旅行', category: '旅行与地点', confidence: 0.9, reason: 'Matches the note.' }]
        }) })}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 70, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.newCollectionDetails, [])
    assert.deepEqual(body.suggestions.newTags, ['React'])
    assert.match(calls[0][1].messages[0].content, /Bookmark note is user context only/)
    assert.match(calls[0][1].messages.at(-1).content, /"note":"/)
})

test('AI fallback suggestions ignore note-only topic signals', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 71,
        user_id: 1,
        url: 'https://react.dev/reference/rsc',
        title: 'React Server Components',
        description: 'React 官方文档，介绍 Server Components 与渲染机制。',
        note: '这是东京自由行攻略，包含美食和直播源整理。',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{\\"status\\":\\"no_match\\",\\"tags\\":[],\\"new_tags\\":[]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 71, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(!body.suggestions.newTags.includes('自由行'))
    assert.ok(!body.suggestions.newTags.includes('美食'))
    assert.ok(!body.suggestions.newTags.includes('直播源整理'))
    assert.deepEqual(body.suggestions.newCollectionDetails, [])
})

test('AI collection suggestions cap the primary recommendation and alternatives', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 63,
        user_id: 1,
        url: 'https://example.test/research',
        title: 'AI Python research',
        description: 'Engineering research notes for Python and AI.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push(
        { id: 3, user_id: 1, title: 'AI Research', parent_id: null },
        { id: 4, user_id: 1, title: 'Python Research', parent_id: null },
        { id: 5, user_id: 1, title: 'Engineering Research', parent_id: null },
        { id: 6, user_id: 1, title: 'Research Notes', parent_id: null }
    )
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({
        collections: [
            { id: 3, confidence: 0.95, reason: 'AI research' },
            { id: 4, confidence: 0.9, reason: 'Python research' },
            { id: 5, confidence: 0.85, reason: 'Engineering research' },
            { id: 6, confidence: 0.8, reason: 'Research notes' }
        ]
    }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 63 })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestions.collections.length, 3)
    assert.deepEqual(body.suggestions.collections.map(item => item.id), [3, 4, 5])
})

test('AI suggestions accept a structured Workers AI response object', async () => {
    const { env } = await environment()
    env.AI.run = async () => ({ response: { collections: [], tags: [], new_tags: ['structured'], new_collections: [] } })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ link: 'https://example.test/structured', title: 'Structured response' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.newTags, ['structured'])
    assert.equal(body.suggestionStatus, 'suggestions')
})

test('AI suggestions include separate user Collection and Tag Prompts', async () => {
    const { env, db, calls } = await environment()
    db.users[0].config = {
        ai_collection_prompt: 'Prefer concise Chinese Collection names.',
        ai_tag_prompt: 'Return no more than two English technology Tags.'
    }
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"response":"{}"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ link: 'https://example.test/custom-prompts', title: 'Custom Prompt Test' })
    }), env)
    assert.equal(response.status, 200)
    assert.match(calls[0][1].messages[0].content, /Prefer concise Chinese Collection names/)
    assert.match(calls[0][1].messages[0].content, /Return no more than two English technology Tags/)
})

test('AI suggestions reject malformed provider output with explicit recovery metadata', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 9,
        user_id: 1,
        url: 'https://example.test/ai',
        title: 'AI bookmark',
        description: 'Research notes',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 3, user_id: 1, title: 'AI Research', parent_id: null })
    env.AI.run = async () => new Response('data: {"response":"not valid JSON"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 9 })
    }), env)
    assert.equal(response.status, 502)
    const body = await response.json()
    assert.equal(body.error, 'ai_provider_invalid_response')
    assert.equal(body.provider, 'workers_ai')
    assert.deepEqual(body.fallbackProviders, [])

    const legacy = await worker.fetch(request('/v1/raindrop/9/suggest'), env)
    assert.equal(legacy.status, 502)
    const legacyBody = await legacy.json()
    assert.equal(legacyBody.error, 'ai_provider_invalid_response')
    assert.equal(legacyBody.provider, 'workers_ai')
})

test('AI suggestion and Description Draft provider failures expose recovery metadata', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 21,
        user_id: 1,
        url: 'https://example.test/provider-failure',
        title: 'Provider failure bookmark',
        description: 'A bookmark used to verify provider recovery.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => { throw new Error('provider down') }

    const suggestions = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 21 })
    }), env)
    assert.equal(suggestions.status, 503)
    const suggestionBody = await suggestions.json()
    assert.equal(suggestionBody.error, 'ai_provider_unavailable')
    assert.equal(suggestionBody.provider, 'workers_ai')
    assert.deepEqual(suggestionBody.fallbackProviders, [])

    const draft = await worker.fetch(request('/v2/ai/description-draft', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 21, language: 'zh-Hans' })
    }), env)
    assert.equal(draft.status, 503)
    const draftBody = await draft.json()
    assert.equal(draftBody.error, 'ai_provider_unavailable')
    assert.equal(draftBody.provider, 'workers_ai')
    assert.deepEqual(draftBody.fallbackProviders, [])
})

test('AI fallback suggestions only keep content-matched tags and short useful tokens', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 11,
        user_id: 1,
        url: 'https://example.test/python',
        title: 'Python reference',
        description: '',
        note: '',
        highlights: '[]',
        tags: '["python","iptv","ai-验证"]'
    })
    db.bookmarks.push({
        id: 12,
        user_id: 1,
        url: 'https://docs.python.org/3/library/asyncio.html',
        title: 'asyncio — Asynchronous I/O',
        description: 'Python async and await APIs for concurrent code.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 12 })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.tags, ['python'])
    assert.ok(body.suggestions.newTags.includes('asyncio'))
    assert.ok(!body.suggestions.newTags.includes('asyncio — Asynchronous I/O'))
    assert.ok(!body.suggestions.tags.includes('iptv'))
    assert.ok(!body.suggestions.tags.includes('ai-验证'))
})

test('AI fallback suggestions derive concise CJK collection and tags from a descriptive title', async () => {
    const { env, db } = await environment()
    const title = '东京五日自由行攻略：浅草、涩谷、镰仓与美食路线'
    db.bookmarks.push({
        id: 18,
        user_id: 1,
        url: 'https://example.test/tokyo-5-day-itinerary',
        title,
        description: '',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 18, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'fallback')
    assert.ok(body.suggestions.newCollections.some(title => /东京|旅行/.test(title)))
    assert.ok(body.suggestions.newTags.some(tag => ['东京', '自由行', '浅草', '涩谷', '镰仓'].includes(tag)))
})

test('AI fallback suggestions preserve useful CJK recipe terms', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 19,
        user_id: 1,
        url: 'https://example.test/sichuan-kung-pao-chicken',
        title: '宫保鸡丁家常做法',
        description: '',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 19, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'fallback')
    assert.ok(body.suggestions.newCollections.some(title => title.includes('菜谱')))
    assert.ok(body.suggestions.newTags.includes('宫保鸡丁'))
})

test('AI suggestions fill a missing tag field when the model only returns a collection', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 20,
        user_id: 1,
        url: 'https://example.test/sichuan-kung-pao-chicken',
        title: '宫保鸡丁家常做法',
        description: '川菜宫保鸡丁食谱：鸡胸肉、花生、干辣椒和花椒。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"{\\"new_collections\\":[{\\"title\\":\\"川菜食谱\\"}]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 20, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(body.suggestions.newCollections.includes('川菜食谱'))
    assert.ok(body.suggestions.newTags.includes('宫保鸡丁'))
})

test('AI suggestions reject a full bookmark title as a model tag', async () => {
    const { env, db } = await environment()
    const title = '东京五日自由行攻略：浅草、涩谷、镰仓与美食路线'
    db.bookmarks.push({ id: 13, user_id: 1, url: 'https://example.test/tokyo', title, description: 'Japan travel itinerary', note: '', highlights: '[]', tags: '[]' })
    env.AI.run = async () => new Response(`data: {"response":${JSON.stringify(JSON.stringify({ new_tags: [title, '日本旅行'] }))}}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 13 })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.newTags, ['日本旅行'])
})

test('AI suggestions reject descriptive tags and keep five total suggestions', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({ id: 24, user_id: 1, url: 'https://example.test/tags', title: '旅行标签', description: '旅行地点', note: '', highlights: '[]', tags: '[]' })
    db.bookmarks.push({ id: 25, user_id: 1, url: 'https://example.test/tags-2', title: '已有标签', description: '', note: '', highlights: '[]', tags: '["旅行"]' })
    env.AI.run = async () => new Response('data: {"response":"{\\"tags\\":[\\"旅行\\",\\"地点\\",\\"路线\\",\\"攻略\\"],\\"new_tags\\":[\\"浅草\\",\\"浅草\\",\\"涩谷\\",\\"镰仓\\",\\"面向第一次去日本的游客\\",\\"第一次去日本的游客必看路线\\",\\"这是一段描述。\\"]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 24, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    const allTags = [...body.suggestions.tags, ...body.suggestions.newTags]
    assert.ok(allTags.length <= 5)
    assert.equal(new Set(allTags.map(tag => tag.toLowerCase())).size, allTags.length)
    assert.ok(!allTags.includes('面向第一次去日本的游客'))
    assert.ok(!allTags.includes('第一次去日本的游客必看路线'))
    assert.ok(!allTags.includes('这是一段描述。'))
})

test('AI suggestions preserve concise domain tags containing common description words', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 29,
        user_id: 1,
        url: 'https://example.test/ux-research',
        title: '用户体验研究',
        description: '用户研究方法、使用说明与服务提供商案例。如何使用该工具，为什么值得阅读。',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({ new_tags: ['用户体验', '用户研究', '使用说明', '面向用户提供帮助', '这是使用说明', '如何使用该工具', '为什么值得阅读'] }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 29, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.newTags, ['用户体验', '用户研究', '使用说明'])
    assert.ok(!body.suggestions.newTags.includes('面向用户提供帮助'))
    assert.ok(!body.suggestions.newTags.includes('这是使用说明'))
    assert.ok(!body.suggestions.newTags.includes('如何使用该工具'))
    assert.ok(!body.suggestions.newTags.includes('为什么值得阅读'))
})

test('AI suggestions use token boundaries for short Latin candidates', async () => {
    const { env, db } = await environment()
    db.bookmarks.push(
        { id: 30, user_id: 1, url: 'https://example.test/raindrop-guide', title: 'Raindrop guide', description: '', note: '', highlights: '[]', tags: '[]' },
        { id: 31, user_id: 1, url: 'https://example.test/ai-guide', title: 'AI guide', description: '', note: '', highlights: '[]', tags: '[]' }
    )
    db.collections.push({ id: 5, user_id: 1, title: 'AI', parent_id: null })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({ collections: [{ id: 5, confidence: 0.9, reason: '推荐' }], new_tags: ['AI'] }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const unrelated = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 30, language: 'en' })
    }), env)
    assert.equal(unrelated.status, 200)
    const unrelatedBody = await unrelated.json()
    assert.equal(unrelatedBody.suggestionStatus, 'fallback')
    assert.deepEqual(unrelatedBody.suggestions.collections, [])
    assert.deepEqual(unrelatedBody.suggestions.newTags, ['Raindrop'])

    const related = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 31, language: 'en' })
    }), env)
    assert.equal(related.status, 200)
    const relatedBody = await related.json()
    assert.equal(relatedBody.suggestionStatus, 'suggestions')
    assert.deepEqual(relatedBody.suggestions.collections.map(item => item.id), [5])
    assert.deepEqual(relatedBody.suggestions.newTags, ['AI'])
})

test('AI suggestions expose an explicit no-match result', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 10,
        user_id: 1,
        url: 'https://example.test/unmatched',
        title: 'Unmatched bookmark',
        description: 'No candidate terms',
        note: '',
        highlights: '[]',
        tags: '["unmatched","bookmark","no","candidate","terms"]'
    })
    db.collections.push({ id: 3, user_id: 1, title: 'Engineering', parent_id: null })
    env.AI.run = async () => new Response('data: {"response":"{\\"collections\\":[{\\"id\\":999}]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 10 })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'no_match')
    assert.equal(body.suggestionSource, 'fallback')
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.tags, [])
    assert.deepEqual(body.suggestions.newTags, [])
})

test('AI suggestions preserve an explicit model no-match without heuristic generation', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 22,
        user_id: 1,
        url: 'https://example.test/no-match',
        title: 'New bookmark',
        description: '',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 6, user_id: 1, title: 'Python', parent_id: null })
    env.AI.run = async () => new Response('data: {"response":"{\\"status\\":\\"no_match\\",\\"collections\\":[],\\"tags\\":[],\\"new_tags\\":[],\\"new_collections\\":[]}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 22 })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'no_match')
    assert.equal(body.suggestionSource, 'model')
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.tags, [])
    assert.deepEqual(body.suggestions.newTags, [])
})

test('AI description draft is editable output and never writes the Bookmark', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 7,
        user_id: 1,
        url: 'https://example.test/article',
        title: 'Article',
        description: 'Original description',
        note: '',
        highlights: '[]'
    })
    env.AI.run = async () => new Response('data: {"response":"A proposed description."}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/description-draft', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 7, language: 'en' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.draft, 'A proposed description.')
    assert.equal(Object.hasOwn(body, 'descriptionDraft'), false)
    assert.equal(db.bookmarks[0].description, 'Original description')
})

test('AI note draft accepts edit-page metadata without writing the Bookmark', async () => {
    const { env, calls } = await environment()
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"response":"A concise personal note."}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/description-draft', {
        method: 'POST',
        body: JSON.stringify({
            link: 'https://example.test/new',
            title: 'New bookmark',
            description: 'A short summary',
            field: 'note',
            language: 'zh-Hans'
        })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.field, 'note')
    assert.equal(body.draft, 'A concise personal note.')
    assert.match(calls[0][1].messages[0].content, /Bookmark note/)
})

test('AI note draft applies the saved prompt and enables model thinking', async () => {
    const { env, calls } = await environment()
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"response":"Useful note."}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/description-draft', {
        method: 'POST',
        body: JSON.stringify({
            link: 'https://example.test/new',
            title: 'New bookmark',
            field: 'note',
            notePrompt: 'Explain why this bookmark matters to a future reader.',
            thinking: true
        })
    }), env)

    assert.equal(response.status, 200)
    assert.match(calls[0][1].messages[0].content, /Explain why this bookmark matters to a future reader\./)
    assert.deepEqual(calls[0][1].chat_template_kwargs, { enable_thinking: true })
})

test('AI context endpoint exposes only authorized Bookmark metadata', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 7,
        user_id: 1,
        url: 'https://example.test/article',
        title: 'Article',
        description: 'Metadata only',
        note: '',
        highlights: '[]'
    })
    db.bookmarks.push({ id: 8, user_id: 2, url: 'https://example.test/private', title: 'Private', description: '', note: '', highlights: '[]' })

    const response = await worker.fetch(request('/v2/ai/context?raindropId=7'), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.package.bookmarks.map(item => item.title), ['Article'])
    assert.deepEqual(body.sources, [{ raindropId: 7, title: 'Article', url: 'https://example.test/article' }])
    assert.doesNotMatch(JSON.stringify(body), /Private/)
    const missing = await worker.fetch(request('/v2/ai/context'), env)
    assert.equal(missing.status, 404)
})

test('legacy Bookmark suggestion endpoints return the client-compatible item shape', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/article', title: 'Article', description: '', note: '', highlights: '[]', tags: '[]' })
    env.AI.run = async () => new Response('data: {"response":"{}"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
    })
    const response = await worker.fetch(request('/v1/raindrop/7/suggest'), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(Array.isArray(body.item.collections))
    assert.ok(Array.isArray(body.item.tags))
    assert.ok(Array.isArray(body.item.new_tags))
    assert.ok(Array.isArray(body.item.create_suggestions))
    assert.ok(Array.isArray(body.item.collection_recommendations))

    const created = await worker.fetch(request('/v1/raindrop/suggest', {
        method: 'POST',
        body: JSON.stringify({ link: 'https://example.test/new', title: 'New bookmark' })
    }), env)
    assert.equal(created.status, 200)
    const createdBody = await created.json()
    assert.ok(Array.isArray(createdBody.item.collections))
})

test('AI normalizes Cloudflare bookmark metadata and removes account-derived values', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({
        id: 70,
        user_id: 1,
        url: 'https://dash.cloudflare.com/7baee5dad8b5885d33227ae7753dc3e0/home',
        title: '账户主页 | Stanley270034@gmail.com\'s Account | Cloudflare',
        description: 'Log in to the Cloudflare dashboard. Make your websites, apps, and networks fast and secure.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 31, user_id: 1, title: '技术与开发', parent_id: null })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response(`data: ${JSON.stringify({ response: JSON.stringify({
            normalized_title: '账户主页 | Stanley270034@gmail.com\'s Account | Cloudflare',
            note: 'Cloudflare 账户后台（Stanley270034@gmail.com），用于管理域名、DNS、CDN、SSL/TLS、防火墙及网站安全配置。',
            collections: [{ id: 31, confidence: 0.95, reason: 'Cloud infrastructure belongs with development tools.' }],
            new_collections: [{ title: '基础设施与云服务', category: '技术与开发', parentId: 31, confidence: 0.92 }],
            new_tags: ['账户主页', 'Stanley270034', 'gmail.com', 'Account', 'Cloudflare']
        }) })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }

    const response = await worker.fetch(request('/v1/raindrop/70/suggest'), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.item.normalized_title, 'Cloudflare Dashboard')
    assert.equal(body.item.note, 'Cloudflare 账户后台，用于管理域名、DNS、CDN、SSL/TLS、防火墙及网站安全配置。')
    assert.deepEqual(body.item.new_collection_details.map(item => [item.parentId, item.title]), [[31, '云服务']])
    assert.deepEqual(body.item.new_tags, ['Cloudflare', 'DNS', 'CDN', '域名管理', '网站运维', '网络安全'])
    assert.doesNotMatch(JSON.stringify(body.item), /Stanley270034|gmail\.com|账户主页|\bAccount\b/iu)
    assert.match(calls[0][1].messages[0].content, /Never mechanically split the page title into Tags/)
    assert.match(calls[0][1].messages[0].content, /normalized_title must identify the durable resource/)
})

test('AI read tools return only authorized context and catalog writes as proposals', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/owned', title: 'Owned bookmark', description: 'Visible', note: '', highlights: '[]', tags: '[]' })
    db.bookmarks.push({ id: 8, user_id: 2, url: 'https://example.test/private', title: 'Private bookmark', description: 'Hidden', note: '', highlights: '[]', tags: '[]' })

    const toolsResponse = await worker.fetch(request('/v2/ai/tools'), env)
    assert.equal(toolsResponse.status, 200)
    const toolsBody = await toolsResponse.json()
    assert.deepEqual(toolsBody.tools.map(item => item.name), ['bookmark_read', 'bookmark_update', 'bookmark_delete'])
    assert.equal(toolsBody.tools.find(item => item.name === 'bookmark_update').approval, 'action_proposal')

    const readResponse = await worker.fetch(request('/v2/ai/tools/execute', { method: 'POST', body: JSON.stringify({ tool: 'bookmark_read', bookmarkId: 7 }) }), env)
    assert.equal(readResponse.status, 200)
    assert.deepEqual((await readResponse.json()).package.bookmarks.map(item => item.title), ['Owned bookmark'])
    const privateRead = await worker.fetch(request('/v2/ai/tools', { method: 'POST', body: JSON.stringify({ tool: 'bookmark_read', bookmarkId: 8 }) }), env)
    assert.equal(privateRead.status, 404)
})

test('AI chat tool calls execute authorized reads and create pending write proposals', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/tool', title: 'Tool bookmark', description: 'Original', note: '', highlights: '[]', tags: '[]', collection_id: -1, created_at: Date.now(), updated_at: Date.now() })
    env.AI.run = async (...args) => {
        calls.push(args)
        return new Response('data: {"toolCalled":{"name":"bookmark_update","raindropId":7,"changes":{"title":"Proposed title"}}}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }
    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Rename this bookmark' }) }), env)
    assert.equal(response.status, 200)
    const stream = await response.text()
    assert.match(stream, /"status":"pending"/)
    assert.match(stream, /"proposal"/)
    assert.equal(db.bookmarks[0].title, 'Tool bookmark')
    assert.deepEqual(calls[0][1].tools.map(item => item.name), ['bookmark_read', 'bookmark_update', 'bookmark_delete'])
})

test('AI chat returns authorized tool results to the model for a continuation round', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/owned', title: 'Owned bookmark', description: 'Visible', note: '', highlights: '[]', tags: [] })
    db.bookmarks.push({ id: 8, user_id: 2, url: 'https://example.test/private', title: 'Private bookmark', description: 'Hidden', note: '', highlights: '[]', tags: [] })
    env.AI.run = async (...args) => {
        calls.push(args)
        if (calls.length === 1) return {
            tool_calls: [
                { id: 'read-owned', name: 'bookmark_read', arguments: { bookmarkId: 7 } },
                { id: 'read-private', name: 'bookmark_read', arguments: { bookmarkId: 8 } }
            ]
        }
        return new Response('data: {"response":"Authorized answer"}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Read my bookmark' }) }), env)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Authorized answer/)
    assert.equal(calls.length, 2)
    const continuation = calls[1][1]
    const toolMessages = continuation.messages.filter(item => item.role === 'tool')
    assert.equal(toolMessages.length, 2)
    const toolAssistants = continuation.messages.filter(item => item.role === 'assistant').slice(-2)
    assert.match(toolAssistants[0].content, /"name":"bookmark_read"/)
    assert.doesNotMatch(toolAssistants[0].content, /tool_calls|tool_call_id/)
    assert.match(toolMessages[0].content, /Owned bookmark/)
    assert.match(toolMessages[1].content, /bookmark_not_found/)
    assert.doesNotMatch(toolMessages[1].content, /Private bookmark/)
    assert.deepEqual(continuation.tools.map(item => item.name), ['bookmark_read', 'bookmark_update', 'bookmark_delete'])
})

test('AI chat merges streamed tool-call argument fragments before execution', async () => {
    const { env, db, calls } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/owned', title: 'Fragmented bookmark', description: 'Visible', note: '', highlights: '[]', tags: [] })
    env.AI.run = async (...args) => {
        calls.push(args)
        if (calls.length === 1) return new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"tool_calls":[{"index":0,"name":"bookmark_read"}]}\n\n'))
                controller.enqueue(new TextEncoder().encode('data: {"tool_calls":[{"index":0,"arguments":"{\\"bookmarkId\\":7}"}]}\n\n'))
                controller.close()
            }
        })
        return new Response('data: {"response":"Fragment read complete"}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' }
        })
    }

    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Read bookmark 7' }) }), env)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Fragment read complete/)
    assert.equal(calls.length, 2)
    assert.match(calls[1][1].messages.find(item => item.role === 'tool').content, /Fragmented bookmark/)
})

test('AI writes remain pending until approved or rejected', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/action', title: 'Action bookmark', description: 'Original', note: '', highlights: '[]', tags: '[]', collection_id: -1, created_at: Date.now(), updated_at: Date.now() })

    const created = await worker.fetch(request('/v2/ai/action-proposals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_update', bookmarkId: 7, changes: { description: 'Proposed description' } })
    }), env)
    assert.equal(created.status, 201)
    const proposal = (await created.json()).proposal
    assert.equal(proposal.status, 'pending')
    assert.equal(db.bookmarks[0].description, 'Original')
    const getApprove = await worker.fetch(request('/v2/ai/action-proposals/' + proposal.id + '/approve'), env)
    assert.equal(getApprove.status, 404)
    assert.equal(db.bookmarks[0].description, 'Original')

    const rejected = await worker.fetch(request('/v2/ai/action-proposals/' + proposal.id + '/reject', { method: 'POST' }), env)
    assert.equal(rejected.status, 200)
    assert.equal((await rejected.json()).proposal.status, 'rejected')
    assert.equal(db.bookmarks[0].description, 'Original')

    const approvedCreate = await worker.fetch(request('/v2/ai/proposals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_update', bookmarkId: 7, payload: { description: 'Approved description' } })
    }), env)
    assert.equal(approvedCreate.status, 201)
    const approvedProposal = (await approvedCreate.json()).proposal
    const approved = await worker.fetch(request('/v2/ai/proposals/' + approvedProposal.id + '/decision', {
        method: 'POST', body: JSON.stringify({ decision: 'approve' })
    }), env)
    assert.equal(approved.status, 200)
    assert.equal((await approved.json()).proposal.status, 'applied')
    assert.equal(db.bookmarks[0].description, 'Approved description')

    const deleteCreate = await worker.fetch(request('/v2/ai/action-proposals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_delete', bookmarkId: 7 })
    }), env)
    assert.equal(deleteCreate.status, 201)
    const deleteProposal = (await deleteCreate.json()).proposal
    const deleted = await worker.fetch(request('/v2/ai/action-proposals/' + deleteProposal.id + '/approve', { method: 'POST' }), env)
    assert.equal(deleted.status, 200)
    assert.equal(db.bookmarks[0].removed_at > 0, true)
})

test('AI proposal decisions claim the pending row before applying a write', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/action', title: 'Action bookmark', description: 'Original', note: '', highlights: '[]', tags: '[]', collection_id: -1, created_at: Date.now(), updated_at: Date.now() })
    const created = await worker.fetch(request('/v2/ai/action-proposals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_update', bookmarkId: 7, changes: { title: 'Claimed once' } })
    }), env)
    const proposal = (await created.json()).proposal
    const [approved, rejected] = await Promise.all([
        worker.fetch(request('/v2/ai/action-proposals/' + proposal.id + '/approve', { method: 'POST' }), env),
        worker.fetch(request('/v2/ai/action-proposals/' + proposal.id + '/reject', { method: 'POST' }), env)
    ])
    assert.deepEqual([approved.status, rejected.status].sort(), [200, 409])
    assert.equal(db.bookmarks[0].title, 'Claimed once')
    assert.equal(db.proposals[0].status, 'applied')
})

test('standing AI approval is scoped to one tool and Collection and can be revoked', async () => {
    const { env, db } = await environment()
    db.collections.push({ id: 3, user_id: 1, title: 'Scoped collection', parent_id: null, removed_at: null })
    db.bookmarks.push({ id: 7, user_id: 1, url: 'https://example.test/action', title: 'Action bookmark', description: 'Original', note: '', highlights: '[]', tags: '[]', collection_id: 3, created_at: Date.now(), updated_at: Date.now() })

    const grant = await worker.fetch(request('/v2/ai/approvals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_update', collectionId: 3 })
    }), env)
    assert.equal(grant.status, 201)
    const approval = (await grant.json()).approval
    assert.equal(approval.collectionId, 3)

    const auto = await worker.fetch(request('/v2/ai/action-proposals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_update', bookmarkId: 7, changes: { title: 'Auto-approved' } })
    }), env)
    assert.equal(auto.status, 200)
    assert.equal((await auto.json()).autoApproved, true)
    assert.equal(db.bookmarks[0].title, 'Auto-approved')

    const revoked = await worker.fetch(request('/v2/ai/approvals/' + approval.id, { method: 'DELETE' }), env)
    assert.equal(revoked.status, 200)
    assert.equal((await revoked.json()).revoked, true)
    const afterRevoke = await worker.fetch(request('/v2/ai/action-proposals', {
        method: 'POST', body: JSON.stringify({ tool: 'bookmark_update', bookmarkId: 7, changes: { title: 'Needs approval' } })
    }), env)
    assert.equal(afterRevoke.status, 201)
    assert.equal((await afterRevoke.json()).proposal.status, 'pending')
})

test('AI suggestions return no_match for low-information bookmarks with unrelated model candidates', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 24,
        user_id: 1,
        url: 'https://example.test/blank-bookmark',
        title: '',
        description: '',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 4, user_id: 1, title: '直播源管理', parent_id: null })
    const model = {
        collections: [{ id: 4, confidence: 0.9, reason: '不相关' }],
        tags: ['iptv', '东京'],
        new_collections: [{ title: 'Chrome 浏览器扩展', category: '技术与开发', confidence: 0.7 }]
    }
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify(model) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 24, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'no_match')
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.tags, [])
    assert.deepEqual(body.suggestions.newTags, [])
    assert.deepEqual(body.suggestions.newCollections, [])
})

test('AI suggestions drop model tags unrelated to the bookmark content', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 26,
        user_id: 1,
        url: 'https://docs.python.org/3/library/asyncio.html',
        title: 'asyncio — Asynchronous I/O',
        description: 'Python async and await APIs for concurrent code.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    const model = { tags: ['iptv', 'ai-验证', 'python', 'async'] }
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify(model) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 26, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.tags, [])
    assert.deepEqual(body.suggestions.newTags, ['python', 'async'])
})

test('AI suggestions filter unrelated existing and low-confidence new collections', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 27,
        user_id: 1,
        url: 'https://docs.python.org/3/library/asyncio.html',
        title: 'asyncio — Asynchronous I/O',
        description: 'Python async and await APIs for concurrent code.',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    db.collections.push({ id: 4, user_id: 1, title: '直播源管理', parent_id: null })
    const model = {
        collections: [{ id: 4, confidence: 0.95, reason: '推荐' }],
        new_collections: [
            { title: '随机收藏', confidence: 0.9, reason: '推荐' },
            { title: 'Python 并发', confidence: 0.4 },
            { title: 'Python 并发编程', confidence: 0.8 }
        ]
    }
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify(model) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 27, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.newCollections, ['Python 并发编程'])
})

test('AI suggestions return no_match for placeholder titles without metadata', async () => {
    const { env, db } = await environment()
    db.bookmarks.push({
        id: 28,
        user_id: 1,
        url: 'https://example.test/placeholder',
        title: 'Untitled page',
        description: '',
        note: '',
        highlights: '[]',
        tags: '[]'
    })
    env.AI.run = async () => new Response(`data: ${JSON.stringify({ response: JSON.stringify({ tags: ['iptv'], new_collections: ['IPTV'] }) })}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
    })

    const response = await worker.fetch(request('/v2/ai/suggestions', {
        method: 'POST',
        body: JSON.stringify({ raindropId: 28, language: 'zh-Hans' })
    }), env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestionStatus, 'no_match')
    assert.deepEqual(body.suggestions.collections, [])
    assert.deepEqual(body.suggestions.tags, [])
    assert.deepEqual(body.suggestions.newTags, [])
    assert.deepEqual(body.suggestions.newCollections, [])
})

test('AI model catalog exposes Cloudflare thinking metadata without exposing credentials', async () => {
    const { env } = await environment()
    env.CF_ACCOUNT_ID = 'account'
    env.CF_API_TOKEN = 'secret-token'
    const originalFetch = globalThis.fetch
    let requestUrl = ''
    let requestHeaders
    globalThis.fetch = async (url, options = {}) => {
        requestUrl = String(url)
        requestHeaders = options.headers
        return Response.json({ success: true, result: [{
            id: '@cf/moonshotai/kimi-k2.6',
            name: 'Kimi K2.6',
            task: 'Text Generation',
            capabilities: ['Reasoning', 'Function Calling']
        }] })
    }
    try {
        const response = await worker.fetch(request('/v2/ai/models'), env)
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.source, 'cloudflare')
        assert.equal(body.models[0].id, '@cf/moonshotai/kimi-k2.6')
        assert.equal(body.models[0].reasoning, true)
        assert.equal(body.models[0].reasoningParameter, 'chat_template_kwargs.thinking')
        assert.match(requestUrl, /accounts%2Faccount|accounts\/account/)
        assert.equal(requestHeaders.Authorization, 'Bearer secret-token')
        assert.doesNotMatch(JSON.stringify(body), /secret-token/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('AI model catalog marks GLM Flash as paid and model testing preserves Workers AI errors', async () => {
    const { env } = await environment()
    env.CF_ACCOUNT_ID = 'account'
    env.CF_API_TOKEN = 'secret-token'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ success: true, result: [{
        id: '@cf/zai-org/glm-5.3-flash',
        task: 'Text Generation'
    }] })
    try {
        const catalog = await worker.fetch(request('/v2/ai/models'), env)
        assert.equal((await catalog.json()).models[0].paidOnly, true)
    } finally {
        globalThis.fetch = originalFetch
    }

    env.AI.run = async () => { throw new Error('Inference failed with code 5035') }
    const testResponse = await worker.fetch(request('/v2/ai/models/test', {
        method: 'POST',
        body: JSON.stringify({ model: '@cf/zai-org/glm-5.3-flash' })
    }), env)
    const body = await testResponse.json()
    assert.equal(testResponse.status, 403)
    assert.equal(body.error, 'ai_model_requires_paid_plan')
    assert.match(body.errorMessage, /Paid plan|prepaid/i)
})

test('Workers AI model test rejects incompatible non-JSON output', async () => {
    const { env } = await environment()
    env.AI.run = async () => new Response('data: {"response":"not json"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    const response = await worker.fetch(request('/v2/ai/models/test', {
        method: 'POST',
        body: JSON.stringify({ model: '@cf/meta/llama-3.2-3b-instruct' })
    }), env)
    assert.equal(response.status, 422)
    assert.equal((await response.json()).error, 'ai_provider_invalid_response')
})

test('AI model catalog derives a short display name and exposes sanitized upstream failures', async () => {
    const { env } = await environment()
    env.CF_ACCOUNT_ID = 'account'
    env.CF_API_TOKEN = 'secret-token'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ success: true, result: [
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', task: 'Text Generation' },
        { id: '@cf/qwen/qwen3-embedding-0.6b', task: 'Text Embeddings', description: 'Qwen3 embedding model' }
    ] })
    try {
        const response = await worker.fetch(request('/v2/ai/models'), env)
        const body = await response.json()
        assert.equal(body.models[0].name, 'Llama 3.3 70B Instruct FP8 Fast')
        const embedding = body.models.find(model => model.id === '@cf/qwen/qwen3-embedding-0.6b')
        assert.equal(embedding.selectable, false)
        assert.equal(embedding.reasoning, false)
    } finally {
        globalThis.fetch = originalFetch
    }

    globalThis.fetch = async () => Response.json({ success: false, errors: [{ code: 9109, message: 'Invalid API token' }] }, { status: 403 })
    try {
        const response = await worker.fetch(request('/v2/ai/models'), env)
        const body = await response.json()
        assert.equal(body.source, 'fallback')
        assert.equal(body.errorCode, '9109')
        assert.equal(body.errorStatus, 403)
        assert.doesNotMatch(JSON.stringify(body), /secret-token|Invalid API token/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('selected thinking model and level reach Workers AI and AI Gateway', async () => {
    const { env, db, calls } = await environment()
    db.users[0].config = JSON.stringify({
        ai_workers_model: '@cf/moonshotai/kimi-k2.6',
        ai_thinking_enabled: true,
        ai_thinking_level: 'high'
    })
    env.AI_GATEWAY_ID = 'default'
    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Think' }) }), env)
    assert.equal(response.status, 200)
    await response.text()
    assert.equal(calls[0][0], '@cf/moonshotai/kimi-k2.6')
    assert.equal(calls[0][1].chat_template_kwargs.thinking, true)
    assert.equal(calls[0][1].chat_template_kwargs.thinking_budget, 2048)
    assert.equal(calls[0][2].gateway.id, 'default')
    assert.equal(calls[0][2].gateway.collectLog, true)
})

test('selected gpt-oss exposes reasoning settings and sends reasoning_effort', async () => {
    const { env, db, calls } = await environment()
    db.users[0].config = JSON.stringify({
        ai_workers_model: '@cf/openai/gpt-oss-120b',
        ai_thinking_enabled: true,
        ai_thinking_level: 'high'
    })
    const config = await worker.fetch(request('/v2/ai/config'), env)
    const configBody = await config.json()
    assert.equal(configBody.workersAi.thinking.available, true)
    assert.equal(configBody.workersAi.thinking.enabled, true)
    assert.equal(configBody.workersAi.modelInfo.reasoningParameter, 'reasoning_effort')

    const response = await worker.fetch(request('/v2/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Think' }) }), env)
    assert.equal(response.status, 200)
    await response.text()
    assert.equal(calls[0][1].reasoning_effort, 'high')
    assert.equal(Object.hasOwn(calls[0][1], 'chat_template_kwargs'), false)
})

test('AI Gateway quota returns live balance, history, threshold alert, and per-model totals', async () => {
    const { env } = await environment()
    env.CF_ACCOUNT_ID = 'account'
    env.CF_API_TOKEN = 'secret-token'
    env.AI_GATEWAY_ID = 'default'
    env.AI_GATEWAY_LOW_BALANCE_THRESHOLD = '5'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async url => {
        const value = String(url)
        if (value.includes('/billing/credit-balance'))
            return Response.json({ success: true, result: { balance: 2.5 } })
        if (value.includes('/billing/usage-history'))
            return Response.json({ success: true, result: { history: [{ id: 'h1', aggregated_value: 1.2, start_time: Date.now() - 86400000, end_time: Date.now() }] } })
        if (value.includes('/logs'))
            return Response.json({ success: true, result: [
                { model: '@cf/meta/llama', created_at: new Date().toISOString(), tokens_in: 10, tokens_out: 5, cost: 0.2 },
                { model: '@cf/meta/llama', created_at: new Date().toISOString(), tokens_in: 20, tokens_out: 8, cost: 0.3 }
            ], result_info: { total_count: 2 } })
        throw new Error('unexpected Cloudflare API request')
    }
    try {
        const response = await worker.fetch(request('/v2/ai/quota?days=7'), env)
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.quota.balance, 2.5)
        assert.equal(body.quota.warning, true)
        assert.equal(body.quota.byModel[0].model, '@cf/meta/llama')
        assert.equal(body.quota.byModel[0].requests, 2)
        assert.equal(body.quota.usage.tokensIn, 30)
        assert.equal(body.quota.history.length, 1)
        assert.equal(body.quota.billingHistory[0].value, 1.2)
        assert.equal(body.quota.gateway.usageAvailable, true)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('AI Gateway quota exposes a configured-but-unavailable state without secrets', async () => {
    const { env } = await environment()
    env.CF_ACCOUNT_ID = 'account'
    env.CF_API_TOKEN = 'secret-token'
    env.AI_GATEWAY_ID = 'default'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('network down') }
    try {
        const response = await worker.fetch(request('/v2/ai/quota'), env)
        const body = await response.json()
        assert.equal(body.quota.gateway.configured, true)
        assert.equal(body.quota.gateway.usageAvailable, false)
        assert.equal(body.quota.status, 'unavailable')
        assert.deepEqual(body.quota.errorCodes, ['network_error', 'network_error', 'network_error'])
        assert.doesNotMatch(JSON.stringify(body), /secret-token/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const normalizeRuntimeOrigin = require('../../src/data/modules/runtime-origin.js')

test('extension runtime origins accept HTTPS roots and localhost development origins', () => {
    assert.equal(normalizeRuntimeOrigin('https://bookmarks.example/'), 'https://bookmarks.example')
    assert.equal(normalizeRuntimeOrigin('https://bookmarks.example:8443'), 'https://bookmarks.example:8443')
    assert.equal(normalizeRuntimeOrigin('http://localhost:8787'), 'http://localhost:8787')
    assert.equal(normalizeRuntimeOrigin('http://api.localhost'), 'http://api.localhost')
})

test('extension runtime origins reject insecure public hosts, credentials, and path URLs', () => {
    for (const value of [
        'http://bookmarks.example',
        'https://user:secret@bookmarks.example',
        'https://bookmarks.example/api',
        'https://bookmarks.example/?debug=1',
        'javascript:alert(1)'
    ])
        assert.throws(() => normalizeRuntimeOrigin(value), TypeError, value)
})

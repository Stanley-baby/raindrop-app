/*
 * Web Archive pure helpers. Network, storage, authorization, and queue work
 * remain in index.js so this module stays easy to test in Node.
 */

const assetPattern = /\b(?:src|poster)\s*=\s*(["'])(.*?)\1/gi
const stylesheetPattern = /<link\b[^>]*\brel\s*=\s*(["'])[^"']*stylesheet[^"']*\1[^>]*\bhref\s*=\s*(["'])(.*?)\2[^>]*>/gi
const stylesheetPatternReversed = /<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*\brel\s*=\s*(["'])[^"']*stylesheet[^"']*\3[^>]*>/gi
const srcsetPattern = /\bsrcset\s*=\s*(["'])(.*?)\1/gi

const textDecoder = new TextDecoder()

const decodeHtml = value => String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")

const htmlText = value => decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n'))
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

const htmlTitle = html => {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return decodeHtml(match?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

export const sanitizeArchiveHtml = html => {
    let result = String(html || '')
    result = result
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
        .replace(/<object\b[\s\S]*?<\/object>/gi, '')
        .replace(/<embed\b[^>]*>/gi, '')
        .replace(/<form\b[\s\S]*?<\/form>/gi, '')
        .replace(/<base\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s+(?:src|href|action)\s*=\s*(['"])\s*(?:javascript:|vbscript:|data:text\/html)[\s\S]*?\1/gi, '')
    if (!/<html\b/i.test(result)) result = '<!doctype html><html><head></head><body>' + result + '</body></html>'
    return result
}

const normalizeAssetUrl = (raw, sourceUrl) => {
    const value = String(raw || '').trim()
    if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('mailto:') || value.startsWith('tel:')) return null
    try {
        const url = new URL(value, sourceUrl)
        if (!['http:', 'https:'].includes(url.protocol)) return null
        url.hash = ''
        return url.toString()
    } catch {
        return null
    }
}

export const extractArchiveAssets = (html, sourceUrl, limit = 100) => {
    const found = []
    const seen = new Set()
    const add = value => {
        const url = normalizeAssetUrl(value, sourceUrl)
        if (!url || seen.has(url) || found.length >= limit) return
        seen.add(url)
        found.push(url)
    }
    let match
    while ((match = assetPattern.exec(String(html || '')))) add(match[2])
    while ((match = stylesheetPattern.exec(String(html || '')))) add(match[3])
    while ((match = stylesheetPatternReversed.exec(String(html || '')))) add(match[2])
    while ((match = srcsetPattern.exec(String(html || ''))))
        String(match[2]).split(',').forEach(item => add(item.trim().split(/\s+/)[0]))
    return found
}

export const rewriteArchiveAssetUrls = (html, sourceUrl, assets) => {
    const map = new Map(Object.entries(assets || {}).map(([key, value]) => [normalizeAssetUrl(key, sourceUrl), value]))
    const replace = value => {
        const target = map.get(normalizeAssetUrl(value, sourceUrl))
        return target || value
    }
    let result = String(html || '').replace(assetPattern, (full, quote, value) => {
        const next = replace(value)
        return full.replace(value, next)
    })
    result = result.replace(srcsetPattern, (full, quote, value) => {
        const next = String(value).split(',').map(item => {
            const parts = item.trim().split(/\s+/)
            if (parts.length) parts[0] = replace(parts[0])
            return parts.join(' ')
        }).join(', ')
        return full.replace(value, next)
    })
    result = result.replace(stylesheetPattern, (full, quote, valueQuote, value) => {
        const next = replace(value)
        return full.replace(value, next)
    })
    result = result.replace(stylesheetPatternReversed, (full, quote, value, relQuote) => {
        const next = replace(value)
        return full.replace(value, next)
    })
    return result
}

export const archiveText = (html, limit = 256 * 1024) => htmlText(html).slice(0, limit)

export const archiveTitle = htmlTitle

export const archiveHash = async bytes => {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const archiveBytes = value => {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    return new TextEncoder().encode(String(value || ''))
}

export const decodeArchiveText = bytes => textDecoder.decode(archiveBytes(bytes))

export const archiveFilename = (raw, fallback = 'archive') => {
    const value = String(raw || '').split(/[?#]/)[0].split('/').pop() || fallback
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || fallback
}

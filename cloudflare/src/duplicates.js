const trackingParameter = value => {
    const key = String(value || '').toLowerCase()
    return key.startsWith('utm_') || new Set([
        'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
        'igshid', 'twclid', 'yclid', 'vero_id', '_ga'
    ]).has(key)
}

const serialize = (raw, { dropFragment = false, dropTracking = false, normalizePath = false, stripWww = false, sortQuery = false } = {}) => {
    const url = new URL(raw)
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol === 'http:' && url.port === '80' || url.protocol === 'https:' && url.port === '443') url.port = ''
    if (dropFragment) url.hash = ''
    if (normalizePath) {
        const path = url.pathname || '/'
        url.pathname = path.length > 1 ? path.replace(/\/+$/, '') || '/' : path
    }
    if (stripWww && url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4)
    if (dropTracking || sortQuery) {
        const entries = [...url.searchParams.entries()]
            .filter(([key]) => !dropTracking || !trackingParameter(key))
        if (sortQuery) entries.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
            leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
        url.search = ''
        for (const [key, value] of entries) url.searchParams.append(key, value)
    }
    return url.toString()
}

export const normalizeBookmarkUrl = raw => {
    const value = String(raw || '').trim()
    let parsed
    try { parsed = new URL(value) } catch { return null }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null

    const exactUrl = serialize(value)
    const normalizedUrl = serialize(value, {
        dropFragment: true,
        dropTracking: true,
        normalizePath: true,
        sortQuery: true
    })
    const hostAliasUrl = parsed.hostname.toLowerCase().startsWith('www.')
        ? serialize(value, { dropFragment: true, dropTracking: true, normalizePath: true, stripWww: true, sortQuery: true })
        : null

    return {
        exactUrl,
        normalizedUrl,
        hostAliasUrl,
        evidence: {
            removedFragment: parsed.hash ? parsed.hash.slice(1) : '',
            removedQueryParams: [...parsed.searchParams.keys()].filter(trackingParameter),
            trailingSlash: parsed.pathname.length > 1 && /\/$/.test(parsed.pathname),
            hostAlias: Boolean(hostAliasUrl)
        }
    }
}

export const duplicateKindConfidence = Object.freeze({ exact: 100, tracking: 95, path: 85, host_alias: 70, redirect: 60, legacy: 50 })

export const duplicateKindPriority = Object.freeze({ exact: 5, tracking: 4, path: 3, host_alias: 2, redirect: 1, legacy: 0 })

export const duplicateKindReason = kind => ({
    exact: 'same_url',
    tracking: 'tracking_parameters_removed',
    path: 'trailing_slash_or_fragment',
    host_alias: 'www_alias',
    redirect: 'same_redirect_target',
    legacy: 'legacy_duplicate_marker'
}[kind] || 'similar_url')

export const isTrackingParameter = trackingParameter

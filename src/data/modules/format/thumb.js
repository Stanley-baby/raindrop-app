import normalizeURL from './url'
import { API_ORIGIN, RENDER_URL, WORKERS_BASE_URL, LEGACY_WORKERS_BASE_URL } from '../../constants/app'

export default function(url='') {
    let finalURL = normalizeURL(url)
    if (!finalURL)
        return ''

    if (API_ORIGIN && finalURL.startsWith(`${API_ORIGIN}/v1/content/`))
        return finalURL

    if ((WORKERS_BASE_URL && finalURL.includes(WORKERS_BASE_URL)) ||
        (LEGACY_WORKERS_BASE_URL && finalURL.includes(LEGACY_WORKERS_BASE_URL)))
        return finalURL.replace(/width=\d+/, 'a')

    return RENDER_URL ? RENDER_URL+'/'+encodeURIComponent(finalURL) : finalURL
}

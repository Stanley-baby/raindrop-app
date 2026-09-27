import { API_ORIGIN, WORKERS_BASE_URL, LEGACY_WORKERS_BASE_URL, RENDER_URL } from '../../constants/app'

export default function(url='') {
    if (API_ORIGIN && url.startsWith(`${API_ORIGIN}/v1/content/`))
        return url

    if ((WORKERS_BASE_URL && url.includes(WORKERS_BASE_URL)) ||
        (LEGACY_WORKERS_BASE_URL && url.includes(LEGACY_WORKERS_BASE_URL)))
        return url

    return RENDER_URL ? RENDER_URL+'/'+encodeURIComponent(url) : url
}

function normalizeRuntimeOrigin(value) {
	const url = new URL(String(value || '').trim())

	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
		url.pathname !== '/' || url.search || url.hash ||
		(url.protocol === 'http:' && !(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) || url.hostname.endsWith('.localhost'))))
		throw new TypeError('Enter an HTTPS origin, or HTTP localhost for development')

	return url.origin
}

if (typeof module !== 'undefined' && module.exports)
	module.exports = normalizeRuntimeOrigin

if (typeof window !== 'undefined')
	window.normalizeRuntimeOrigin = normalizeRuntimeOrigin

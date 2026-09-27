import Api from './api'

const pending = new Map()

export default function dedupeGet(url, options={}) {
	const key = url + JSON.stringify(options)
	let request = pending.get(key)

	if (!request) {
		request = Api._get(url, options)
		pending.set(key, request)
		request.then(
			()=>pending.delete(key),
			()=>pending.delete(key)
		)
	}

	return request
}

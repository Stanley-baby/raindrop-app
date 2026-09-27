const isApiPath = pathname =>
    pathname === '/health' || pathname === '/version' ||
    pathname.startsWith('/v1/') || pathname.startsWith('/v2/') ||
    pathname.startsWith('/render/') || pathname.startsWith('/public/content/')

export async function onRequest(context) {
    if (!isApiPath(new URL(context.request.url).pathname))
        return context.next()

    if (!context.env?.API?.fetch)
        return new Response(JSON.stringify({ result: false, error: 'api_binding_missing' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        })

    return context.env.API.fetch(context.request)
}

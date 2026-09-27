import Api from './api'

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export default async bookmarkId => {
    const id = encodeURIComponent(bookmarkId)
    const started = await Api._post(`raindrop/${id}/capture`, { kind: 'screenshot' }, { timeout: 0 })
    if (!started.taskId)
        throw new Error('Screenshot capture was not queued')

    for (let attempt = 0; attempt < 30; attempt++) {
        await wait(1000)
        const result = await Api._get(`tasks/${encodeURIComponent(started.taskId)}`)
        const task = result.task || {}
        if (task.status === 'succeeded') {
            const bookmark = await Api._get(`raindrop/${id}`)
            if (!bookmark.item?.cover)
                throw new Error('Screenshot completed without a cover')
            return bookmark.item
        }
        if (['dead_letter', 'failed'].includes(task.status))
            throw new Error(task.failure?.message || 'Screenshot capture failed')
    }

    throw new Error('Screenshot capture timed out')
}

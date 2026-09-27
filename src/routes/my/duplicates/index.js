import React, { useCallback, useEffect, useState } from 'react'
import { Helmet } from 'react-helmet'
import t from '~t'

import Api from '~data/modules/api'
import Button from '~co/common/button'
import Main, { Content } from '~co/screen/splitview/main'

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms))

const fieldNames = ['title', 'description', 'note', 'cover', 'collection']

const kindLabel = kind => {
    const key = {
        exact: 'duplicateBookmarksKindExact',
        tracking: 'duplicateBookmarksKindTracking',
        path: 'duplicateBookmarksKindPath',
        host_alias: 'duplicateBookmarksKindHostAlias',
        redirect: 'duplicateBookmarksKindRedirect'
    }[kind]
    return key ? t.s(key) : kind
}

export default function PageMyDuplicates() {
    const [groups, setGroups] = useState([])
    const [summary, setSummary] = useState({ groups: 0, bookmarks: 0 })
    const [task, setTask] = useState(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [mergeFields, setMergeFields] = useState({})
    const [mergeOperations, setMergeOperations] = useState(() => {
        if (typeof window === 'undefined') return []
        try {
            const value = JSON.parse(window.localStorage.getItem('duplicateMergeOperations') || '[]')
            return Array.isArray(value) ? value : []
        } catch {
            return []
        }
    })

    useEffect(() => {
        if (typeof window !== 'undefined') window.localStorage.setItem('duplicateMergeOperations', JSON.stringify(mergeOperations))
    }, [mergeOperations])

    const load = useCallback(async () => {
        const result = await Api._get('duplicates?status=open&perpage=100')
        setGroups(result.items || [])
        setSummary(result.summary || { groups: 0, bookmarks: 0 })
        setMergeFields(current => {
            const next = { ...current }
            for (const group of result.items || []) {
                const representative = group.items.find(item => item.role === 'representative')?.bookmarkId || group.items[0]?.bookmarkId
                if (!next[group.id] && representative) {
                    next[group.id] = {
                        survivor: String(representative),
                        ...Object.fromEntries(fieldNames.map(field => [field, String(representative)]))
                    }
                }
            }
            return next
        })
    }, [])

    const poll = useCallback(async taskId => {
        for (let attempt = 0; attempt < 120; attempt++) {
            const result = await Api._get(`tasks/${encodeURIComponent(taskId)}`)
            const current = result.task || {}
            setTask(current)
            if (current.status === 'succeeded') {
                await load()
                setNotice(t.format('duplicateBookmarksFound', current.metadata?.groups || 0, current.metadata?.candidates || 0))
                return current
            }
            if (['dead_letter', 'failed'].includes(current.status))
                throw new Error(current.failure?.message || t.s('duplicateBookmarksFailed'))
            await wait(1000)
        }
        throw new Error(t.s('duplicateBookmarksFailed'))
    }, [load])

    useEffect(() => {
        let active = true
        load().catch(error => active && setError(error.message || t.s('duplicateBookmarksFailed')))
        return () => { active = false }
    }, [load])

    const scan = async () => {
        setError('')
        setNotice('')
        try {
            const result = await Api._post('duplicates/scan', { mode: 'safe' })
            setTask(result.task || { taskId: result.taskId, status: 'queued', progress: 0 })
            await poll(result.taskId)
        } catch (error) {
            setError(error.message || t.s('duplicateBookmarksFailed'))
        }
    }

    const resolve = async (group, action) => {
        setError('')
        setNotice('')
        try {
            const representativeId = group.items.find(item => item.role === 'representative')?.bookmarkId || group.items[0]?.bookmarkId
            const selected = mergeFields[group.id] || {}
            const survivorId = Number(selected.survivor || representativeId)
            const payload = {
                action,
                survivorId,
                expectedFingerprint: group.fingerprint
            }
            if (action === 'merge') payload.fields = Object.fromEntries(fieldNames.map(field => [`${field}Source`, Number(selected[field] || survivorId)]))
            const result = await Api._post(`duplicates/${encodeURIComponent(group.id)}/resolve`, payload)
            setGroups(current => current.filter(item => item.id !== group.id))
            setSummary(current => ({
                groups: Math.max(0, Number(current.groups || 0) - 1),
                bookmarks: Math.max(0, Number(current.bookmarks || 0) - group.items.length)
            }))
            if (action === 'merge' && result.operationId)
                setMergeOperations(current => [{ operationId: result.operationId, groupId: group.id }, ...current.filter(item => item.operationId !== result.operationId)].slice(0, 10))
            setNotice(action === 'merge' ? t.s('duplicateBookmarksMerged') : t.s('duplicateBookmarksDismissed'))
        } catch (error) {
            setError(error.message || t.s('duplicateBookmarksFailed'))
        }
    }

    const undoMerge = async operationId => {
        if (!operationId) return
        setError('')
        try {
            await Api._post(`duplicates/merge/${encodeURIComponent(operationId)}/undo`, {})
            setMergeOperations(current => current.filter(item => item.operationId !== operationId))
            await load()
            setNotice(t.s('duplicateBookmarksUndone'))
        } catch (error) {
            setError(error.message || t.s('duplicateBookmarksFailed'))
        }
    }

    return (
        <Main>
            <Helmet><title>{t.s('duplicateBookmarks')}</title></Helmet>
            <Content>
                <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
                        <div>
                            <h1 style={{ margin: 0 }}>{t.s('duplicateBookmarks')}</h1>
                            <p style={{ margin: '8px 0 0', opacity: .7 }}>
                                {t.format('duplicateBookmarksFound', summary.groups, summary.bookmarks)}
                            </p>
                        </div>
                        <Button variant='outline' onClick={scan} disabled={Boolean(task && ['queued', 'processing', 'retrying'].includes(task.status))}>
                            {task && ['queued', 'processing', 'retrying'].includes(task.status) ? t.s('duplicateBookmarksChecking') : t.s('duplicateBookmarksCheck')}
                        </Button>
                    </div>

                    {task && ['queued', 'processing', 'retrying'].includes(task.status) ? (
                        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: 'var(--background-secondary)' }}>
                            {t.s('duplicateBookmarksChecking')} {Number(task.progress || 0)}%
                        </div>
                    ) : null}
                    {notice ? (
                        <div role='status' style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, color: 'var(--success-color, #16875d)' }}>
                            <span>{notice}</span>
                        </div>
                    ) : null}
                    {mergeOperations.length ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                            {mergeOperations.map(operation => (
                                <Button key={operation.operationId} size='small' variant='outline' onClick={() => undoMerge(operation.operationId)}>
                                    {t.s('duplicateBookmarksUndo')}
                                </Button>
                            ))}
                        </div>
                    ) : null}
                    {error ? <div role='alert' style={{ color: 'var(--error-color, #c33)', marginBottom: 16 }}>{error}</div> : null}

                    {!groups.length ? (
                        <div style={{ padding: 32, textAlign: 'center', opacity: .75 }}>{t.s('duplicateBookmarksNone')}</div>
                    ) : groups.map(group => (
                        <section key={group.id} style={{ marginBottom: 16, padding: 16, border: '1px solid var(--border-color)', borderRadius: 10 }}>
                            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                <div>
                                    <strong>{kindLabel(group.kind)}</strong>
                                    <span style={{ marginLeft: 12, opacity: .65 }}>{t.s('duplicateBookmarksConfidence')}: {group.confidence}%</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button size='small' variant='outline' onClick={() => resolve(group, 'dismiss')}>{t.s('duplicateBookmarksDismiss')}</Button>
                                    <Button size='small' onClick={() => resolve(group, 'merge')}>{t.s('duplicateBookmarksMerge')}</Button>
                                </div>
                            </header>
                            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                                <label style={{ display: 'grid', gap: 4 }}>
                                    <span>{t.s('duplicateBookmarksKeep')}</span>
                                    <select value={String(mergeFields[group.id]?.survivor || group.items[0]?.bookmarkId || '')} onChange={event => setMergeFields(current => ({
                                        ...current,
                                        [group.id]: { ...(current[group.id] || {}), survivor: event.target.value }
                                    }))}>
                                        {group.items.map(item => <option key={item.bookmarkId} value={item.bookmarkId}>{item.title || item.link}</option>)}
                                    </select>
                                </label>
                                {fieldNames.map(field => (
                                    <label key={field} style={{ display: 'grid', gap: 4 }}>
                                        <span>{t.s(`duplicateBookmarksField${field[0].toUpperCase()}${field.slice(1)}`)}</span>
                                        <select value={String(mergeFields[group.id]?.[field] || group.items[0]?.bookmarkId || '')} onChange={event => setMergeFields(current => ({
                                            ...current,
                                            [group.id]: { ...(current[group.id] || {}), [field]: event.target.value }
                                        }))}>
                                            {group.items.map(item => <option key={item.bookmarkId} value={item.bookmarkId}>{item.title || item.link}</option>)}
                                        </select>
                                    </label>
                                ))}
                            </div>
                            <div style={{ display: 'grid', gap: 8 }}>
                                {group.items.map(item => (
                                    <article key={item.bookmarkId} style={{ padding: 12, background: item.role === 'representative' ? 'var(--background-secondary)' : 'transparent', borderRadius: 8 }}>
                                        <div style={{ fontWeight: 600 }}>{item.title || item.link}</div>
                                        <a href={item.link} target='_blank' rel='noreferrer' style={{ wordBreak: 'break-all', opacity: .75 }}>{item.link}</a>
                                        {item.role === 'representative' ? <small style={{ display: 'block', marginTop: 4, opacity: .65 }}>{t.s('duplicateBookmarksRepresentative')}</small> : null}
                                    </article>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </Content>
        </Main>
    )
}

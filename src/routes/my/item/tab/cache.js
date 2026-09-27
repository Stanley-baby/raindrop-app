import s from './cache.module.styl'
import React, { useCallback, useEffect, useState } from 'react'
import t from '~t'
import links from '~config/links'
import Api from '~data/modules/api'

import Header, { Title, Space } from '~co/common/header'
import Button from '~co/common/button'
import Icon from '~co/common/icon'
import Preloader from '~co/common/preloader'

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms))
const activeTask = task => task && ['queued', 'processing', 'retrying'].includes(task.status)
const activeArchive = archive => ['queued', 'capturing', 'packaging', 'scanning'].includes(archive?.status)
const formatBytes = value => {
    let bytes = Math.max(0, Number(value) || 0)
    const units = ['B', 'KB', 'MB', 'GB']
    let unit = 0
    while (bytes >= 1024 && unit < units.length - 1) {
        bytes /= 1024
        unit++
    }
    return `${unit ? bytes.toFixed(1) : bytes} ${units[unit]}`
}

function CacheStatus({ archive, task, quota, onCapture, onPublish, error }) {
    const status = archive?.status || (activeTask(task) ? 'queued' : 'not_requested')
    const busy = activeArchive(archive) || activeTask(task)
    const version = archive?.currentVersion
    const ready = status === 'ready' && version?.viewUrl
    const hasVersion = Boolean(version?.viewUrl)
    const statusLabels = {
        not_requested: 'webArchiveNotAvailable',
        queued: 'webArchiveQueued',
        capturing: 'webArchiveChecking',
        packaging: 'webArchivePackaging',
        scanning: 'webArchiveScanning',
        ready: 'done',
        stale: 'webArchiveStale',
        failed: 'webArchiveFailed',
        blocked: 'webArchiveBlocked',
        deleted: 'webArchiveDeleted'
    }
    const title = t.s(statusLabels[status] || 'webArchiveNotAvailable')
    const details = [
        version ? t.format('webArchiveVersionDetails', formatBytes(version.size), Number(version.assetCount || 0)) : null,
        quota ? t.format('webArchiveQuota', formatBytes(quota.usedBytes), formatBytes(quota.limitBytes)) : null,
        version?.expiresAt ? t.format('webArchiveExpires', new Date(version.expiresAt).toLocaleDateString()) : null,
        version?.published ? t.s('webArchivePublished') : null
    ].filter(Boolean)
    const failed = ['failed', 'blocked'].includes(status)

    return (
        <Header className={s.status} data-status={status}>
            <Icon name={ready ? 'cache_ready' : busy ? 'retry' : failed ? 'cache_failed' : 'cache_retry'} className={s.icon} />
            <Title>
                {title}<br/>
                <small>
                    {archive?.lastError?.message || error || t.s('webArchiveDescription')} {' '}
                    <a href={links.help.permanentCopy} target='_blank' rel='noreferrer'>{t.s('learnMore')}</a>
                </small>
                {busy && task ? <small>{t.format('webArchiveProgress', Number(task.progress || 0))}</small> : null}
                {details.map((detail, index) => <small key={index}>{detail}</small>)}
            </Title>
            <Space />
            {busy ? <Preloader /> : (
                <Button variant='outline' onClick={onCapture}>
                    <Icon name='retry' size='micro' />
                    {version ? t.s('webArchiveRecapture') : t.s('webArchiveCapture')}
                </Button>
            )}
            {hasVersion && (
                <>
                    {(archive.currentVersion.publishable || archive.currentVersion.published) ? (
                        <Button variant='outline' onClick={onPublish}>
                            {archive.currentVersion.published ? t.s('webArchiveUnpublish') : t.s('webArchivePublish')}
                        </Button>
                    ) : null}
                    <Button href={archive.currentVersion.viewUrl} rel='noopener' target='_blank'>
                        <Icon name='open' size='micro' />
                        {t.s('open')}
                    </Button>
                    <Button href={archive.currentVersion.downloadUrl + '?format=zip'}>
                        <Icon name='document' size='micro' />
                        {t.s('download')}
                    </Button>
                </>
            )}
        </Header>
    )
}

export default function PageMyItemTabCache({ item: { _id } }) {
    const [archive, setArchive] = useState(null)
    const [task, setTask] = useState(null)
    const [quota, setQuota] = useState(null)
    const [error, setError] = useState('')

    const load = useCallback(async () => {
        const result = await Api._get(`raindrop/${_id}/archive`)
        setArchive(result.archive || null)
        return result.archive || null
    }, [_id])

    const loadQuota = useCallback(async () => {
        const result = await Api._get('archive/quota')
        setQuota(result.quota || null)
        return result.quota || null
    }, [])

    const poll = useCallback(async taskId => {
        for (let attempt = 0; attempt < 120; attempt++) {
            const result = await Api._get(`tasks/${encodeURIComponent(taskId)}`)
            const current = result.task || {}
            setTask(current)
            if (current.status === 'succeeded') {
                await load()
                await loadQuota().catch(() => {})
                return
            }
            if (['dead_letter', 'failed'].includes(current.status))
                throw new Error(current.failure?.message || t.s('webArchiveFailed'))
            await wait(1000)
        }
        throw new Error(t.s('webArchiveFailed'))
    }, [load, loadQuota])

    useEffect(() => {
        let active = true
        load().then(async current => {
            loadQuota().catch(() => {})
            if (!activeArchive(current)) return

            for (let attempt = 0; attempt < 120; attempt++) {
                if (!active) return
                await wait(1000)
                const latest = await load()
                if (!activeArchive(latest)) return
            }
            if (active) setError(t.s('webArchiveFailed'))
        }).catch(current => active && setError(current.message || String(current)))
        return () => { active = false }
    }, [load, loadQuota])

    const capture = async () => {
        setError('')
        try {
            const result = await Api._post(`raindrop/${_id}/archive`, { trigger: 'manual' })
            setArchive(result.archive || archive)
            setTask(result.task || { taskId: result.taskId, status: 'queued', progress: 0 })
            await poll(result.taskId)
        } catch (current) {
            setError(current.message || String(current))
        }
    }

    const publish = async () => {
        setError('')
        try {
            const versionId = archive?.currentVersion?.id
            if (!versionId) return
            await Api[archive.currentVersion.published ? '_del' : '_post'](`archive/${encodeURIComponent(versionId)}/publish`)
            await load()
        } catch (current) {
            setError(current.message || String(current))
        }
    }

    const ready = archive?.currentVersion?.viewUrl
    return (
        <div className={s.cache}>
            <CacheStatus archive={archive} task={task} quota={quota} onCapture={capture} onPublish={publish} error={error} />
            {ready ? <iframe className={s.frame} title={t.s('webArchive')} src={archive.currentVersion.viewUrl} /> : null}
        </div>
    )
}

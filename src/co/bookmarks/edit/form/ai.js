import s from './ai.module.styl'
import React, { useCallback, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { API_ORIGIN } from '~data/constants/app'
import t from '~t'

import Button from '~co/common/button'
import Icon from '~co/common/icon'

const readJson = async response => {
    try { return await response.json() } catch { return {} }
}

const requestData = item => ({
    ...(Number(item._id) > 0 ? { raindropId: item._id } : {}),
    link: item.link,
    title: item.title,
    description: item.description || item.excerpt || '',
    excerpt: item.excerpt || '',
    note: item.note || '',
    tags: Array.from(item.tags || [])
})

export default function BookmarkEditFormAi({ item, onChange, onLoadingChange, status }) {
    const enabled = useSelector(state => state.config.ai_assistant || state.config.ai_suggestions)
    const notePrompt = useSelector(state => state.config.ai_note_prompt)
    const noteThinking = useSelector(state => state.config.ai_note_thinking)
    const note = String(item.note || '')
    const payload = requestData(item)
    const [loading, setLoading] = useState(false)
    const [draft, setDraft] = useState('')
    const [pendingChoice, setPendingChoice] = useState(false)
    const [lastGenerated, setLastGenerated] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        setDraft('')
        setPendingChoice(false)
        setLastGenerated('')
        setError('')
    }, [item._id, item.link, item.title])

    const loadDraft = useCallback(async event => {
        event.preventDefault()
        if (loading || status === 'loading' || status === 'saving') return

        const replaceAutomatically = !note.trim() || note === lastGenerated
        setLoading(true)
        onLoadingChange?.(true)
        setDraft('')
        setPendingChoice(false)
        setError('')

        try {
            const response = await fetch(API_ORIGIN + '/v2/ai/description-draft', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, language: t.currentLang, field: 'note', notePrompt, thinking: noteThinking })
            })
            const body = await readJson(response)
            if (!response.ok) throw new Error(body.errorMessage || 'AI is unavailable')

            const value = String(body.draft || '').trim()
            if (!value) throw new Error('AI returned an empty note')

            if (replaceAutomatically) {
                onChange({ note: value })
                setLastGenerated(value)
            } else {
                setDraft(value)
                setPendingChoice(true)
            }
        } catch (loadError) {
            setError(loadError.message || 'AI is unavailable')
        } finally {
            setLoading(false)
            onLoadingChange?.(false)
        }
    }, [lastGenerated, loading, note, notePrompt, noteThinking, onChange, onLoadingChange, payload, status])

    const commitDraft = useCallback(mode => {
        if (!draft) return

        const current = String(item.note || '')
        const value = mode === 'append' && current.trim()
            ? current.trim() + '\n\n' + draft
            : draft
        onChange({ note: value })
        setLastGenerated(mode === 'replace' ? draft : '')
        setDraft('')
        setPendingChoice(false)
    }, [draft, item.note, onChange])

    if (!enabled) return null

    const disabled = loading || status === 'loading' || status === 'saving'

    return (
        <div className={s.root}>
            <div className={s.actions}>
                <Button
                    as='button'
                    type='button'
                    data-button='ai'
                    className={s.button}
                    variant='outline'
                    size='small'
                    title={t.s('aiGenerate')}
                    aria-label={t.s('aiGenerate')}
                    aria-busy={loading}
                    disabled={disabled}
                    onClick={loadDraft}>
                    <Icon name='ai' /><span>{t.s('aiGenerate')}</span>
                </Button>

                {pendingChoice && <>
                    <span className={s.choiceLabel}>{t.s('aiDraftReady')}</span>
                    <Button size='small' variant='outline' onClick={() => commitDraft('replace')}>
                        {t.s('aiOverwrite')}
                    </Button>
                    <Button size='small' variant='flat' onClick={() => commitDraft('append')}>
                        {t.s('aiAppend')}
                    </Button>
                </>}
            </div>

            {pendingChoice && <div className={s.preview} aria-live='polite'>{draft}</div>}

            {error && <div className={s.error} role='alert'>
                <span>{error}</span>
                <Button size='small' variant='link' onClick={loadDraft}>{t.s('tryAgain')}</Button>
            </div>}
        </div>
    )
}

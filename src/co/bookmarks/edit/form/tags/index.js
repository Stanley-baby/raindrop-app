import s from './index.module.styl'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import t from '~t'
import { useDispatch, useSelector } from 'react-redux'
import { suggestFields } from '~data/actions/bookmarks'
import { isPro } from '~data/selectors/user'
import { independentService } from '~config/environment'

import { Label } from '~co/common/form'
import Button from '~co/common/button'
import Icon from '~co/common/icon'
import TagsField from '~co/tags/field'
import Suggested from './suggested'

export default function BookmarkEditFormTags({ autoFocus, item, onCommit, onChange, onSave }) {
    const dispatch = useDispatch()
    const [suggesting, setSuggesting] = useState(false)
    const [savingSuggestion, setSavingSuggestion] = useState(false)
    const [selectedTags, setSelectedTags] = useState({})
    const [suggestError, setSuggestError] = useState('')
    const baseTagsRef = useRef(Array.from(item.tags || []))
    const aiEnabled = useSelector(state=>state.config.ai_suggestions)
    const pro = useSelector(state=>isPro(state))

    const onTagsFieldChange = useCallback((tags)=>{
        const nextTags = Array.from(tags || [])
        baseTagsRef.current = nextTags
        setSelectedTags({})
        onChange({ tags: nextTags })
    }, [onChange])

    const onSuggestionClick = useCallback((tag)=>{
        if (savingSuggestion) return
        const selected = selectedTags[tag]
        const next = { ...selectedTags }
        if (selected) delete next[tag]
        else next[tag] = { remove: baseTagsRef.current.includes(tag) }
        const tags = Array.from(baseTagsRef.current).filter(value=>!next[value]?.remove)
        Object.keys(next).forEach(value=>{
            if (!next[value].remove && !tags.includes(value)) tags.push(value)
        })
        setSelectedTags(next)
        onChange({ tags })
    }, [onChange, savingSuggestion, selectedTags])

    const onApplySuggestions = useCallback(()=>{
        if (savingSuggestion || !Object.keys(selectedTags).length || typeof onSave != 'function') return

        setSavingSuggestion(true)
        Promise.resolve(onSave())
            .then(()=>{
                baseTagsRef.current = baseTagsRef.current.filter(value=>!selectedTags[value]?.remove)
                Object.keys(selectedTags).forEach(value=>{
                    if (!selectedTags[value].remove && !baseTagsRef.current.includes(value))
                        baseTagsRef.current.push(value)
                })
                setSelectedTags({})
            })
            .catch(()=>{})
            .finally(()=>setSavingSuggestion(false))
    }, [onSave, savingSuggestion, selectedTags])

    const onSuggest = useCallback(()=>{
        if (suggesting) return
        setSuggestError('')
        setSuggesting(true)
        dispatch(suggestFields(item, true,
            ()=>{
                setSuggesting(false)
                setSuggestError('')
            },
            suggestionError=>{
                setSuggesting(false)
                setSuggestError(suggestionError?.message || t.s('server'))
            },
            'tags'))
    }, [dispatch, item, suggesting])

    useEffect(()=>{
        baseTagsRef.current = Array.from(item.tags || [])
        setSelectedTags({})
        setSuggestError('')
    }, [item._id, item.link])

    const canSuggest = aiEnabled && (pro || independentService)
    const pendingSuggestions = Object.keys(selectedTags).length

    return (
        <>
            <Label>{t.s('tags')}</Label>
            <div>
                <div className={s.field}>
                    <TagsField
                        value={item.tags}
                        spaceId={item.collectionId}

                        autoFocus={autoFocus=='tags'}
                        onChange={onTagsFieldChange}
                        onBlur={onCommit} />
                    {canSuggest && <Button
                        as='button'
                        type='button'
                        variant='outline'
                        size='small'
                        title={t.s('aiGenerate')}
                        aria-label={t.s('aiGenerate')}
                        aria-busy={suggesting || savingSuggestion}
                        disabled={suggesting || savingSuggestion}
                        onClick={onSuggest}>
                        <Icon name='ai' />
                    </Button>}
                    {suggesting && <span className={s.status} role='status' aria-live='polite'>{t.s('aiGenerating')}</span>}
                </div>

                {suggestError && <div className={s.error} role='alert'>
                    <span>{suggestError}</span>
                    <Button as='button' type='button' variant='link' size='small' onClick={onSuggest}>{t.s('tryAgain')}</Button>
                </div>}

                <Suggested
                    item={item}
                    onTagClick={onSuggestionClick}
                    selectedTags={selectedTags}
                    saving={savingSuggestion} />
                {pendingSuggestions > 0 && <div className={s.actions}>
                    <Button
                        as='button'
                        type='button'
                        variant='outline'
                        size='small'
                        disabled={savingSuggestion}
                        aria-label={t.format('applyTagSuggestions', pendingSuggestions)}
                        onClick={onApplySuggestions}>
                        {t.s('applySuggestions')}
                    </Button>
                    {savingSuggestion && <span className={s.status} role='status' aria-live='polite'>{t.s('savingTags')}</span>}
                </div>}
            </div>
        </>
    )
}

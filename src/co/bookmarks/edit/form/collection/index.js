import s from './index.module.styl'
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import t from '~t'
import _ from 'lodash-es'
import { useDispatch, useSelector } from 'react-redux'
import { makeCollectionPath } from '~data/selectors/collections'
import { load, oneCreate, oneRemove } from '~data/actions/collections'
import { suggestFields } from '~data/actions/bookmarks'
import { AI_COLLECTION_TOP_LEVELS } from '~data/constants/ai'
import { isPro } from '~data/selectors/user'
import { independentService } from '~config/environment'

import { Label } from '~co/common/form'
import Button from '~co/common/button'
import Icon from '~co/common/icon'
import CollectionIcon from '~co/collections/item/icon'
import Picker from '~co/collections/picker'
import Suggested from './suggested'

export default function BookmarkEditFormCollection({ item, onChange, onSave, registerBeforeSave, onSuggestionError }) {
    const dispatch = useDispatch()

    const [pick, setPick] = useState(false)
    const [suggesting, setSuggesting] = useState(false)
    const [savingSuggestion, setSavingSuggestion] = useState(false)
    const [selectedSuggestion, setSelectedSuggestion] = useState(null)
    const [pendingLabel, setPendingLabel] = useState('')
    const aiEnabled = useSelector(state=>state.config.ai_suggestions)
    const pro = useSelector(state=>isPro(state))
    const collectionItems = useSelector(state=>state.collections?.items || {})

    //path
    useEffect(()=>dispatch(load()), [])
    const getCollectionPath = useMemo(()=>makeCollectionPath(), [])
    const path = useSelector(state=>getCollectionPath(state, item.collectionId, { self: true }))
    const pathText = useMemo(()=>path.map((p)=>p.title).join(' / '), [path])
    const originalCollectionId = useRef(item.collectionId)
    const pendingTitleRef = useRef('')
    const pendingParentIdRef = useRef(null)
    const pendingCategoryRef = useRef('')

    //button
    const buttonRef = useRef(null)

    const onPickerClick = useCallback((e)=>{
        if (savingSuggestion) return
        e.preventDefault()
        setPick(true)
    }, [savingSuggestion, setPick])

    const onPickerClose = useCallback(()=>{
        setPick(false)
        buttonRef.current?.focus()
    }, [buttonRef, setPick])

    const clearPending = useCallback(()=>{
        pendingTitleRef.current = ''
        pendingParentIdRef.current = null
        pendingCategoryRef.current = ''
        setPendingLabel('')
    }, [])

    const onCollectionChange = useCallback((_id)=>{
        clearPending()
        setSelectedSuggestion(null)
        onChange({ collectionId: _id })
        if (typeof onSave == 'function') {
            setSavingSuggestion(true)
            Promise.resolve(onSave()).catch(()=>{}).finally(()=>setSavingSuggestion(false))
        }
        onPickerClose()
    }, [clearPending, onChange, onSave, onPickerClose])

    const pickerEvents = useMemo(()=>({
        onItemClick: ({ _id })=>onCollectionChange(_id)
    }), [onCollectionChange])

    const persistPendingCollection = useCallback(async()=>{
        const title = pendingTitleRef.current
        if (!title) return

        setSavingSuggestion(true)
        let createdParentId = null
        try {
            let parentId = Number(pendingParentIdRef.current)
            const category = pendingCategoryRef.current
            if (!(Number.isSafeInteger(parentId) && parentId > 0) && AI_COLLECTION_TOP_LEVELS.includes(category)) {
                const existingParent = Object.values(collectionItems).find(collection =>
                    collection?._id > 0 && !collection.parentId && String(collection.title || '').trim() === category)
                if (existingParent)
                    parentId = existingParent._id
                else {
                    const parent = await new Promise((resolve, reject)=>
                        dispatch(oneCreate({ title: category }, resolve, reject)))
                    createdParentId = Number(parent?._id)
                    if (!createdParentId) throw new Error('Collection category creation failed')
                    parentId = createdParentId
                }
            }
            const created = await new Promise((resolve, reject)=>
                dispatch(oneCreate({
                    title,
                    ...(Number.isSafeInteger(parentId) && parentId > 0 ? { parentId } : {})
                }, resolve, reject))
            )
            const createdId = Number(created?._id)
            if (!createdId) throw new Error('Collection creation failed')
            clearPending()
            onChange({ collectionId: createdId })
            return async()=>{
                onChange({ collectionId: originalCollectionId.current })
                await new Promise((resolve, reject)=>dispatch(oneRemove(createdId, resolve, reject)))
                if (createdParentId)
                    await new Promise((resolve, reject)=>dispatch(oneRemove(createdParentId, resolve, reject)))
            }
        } catch (error) {
            if (createdParentId)
                try { await new Promise((resolve, reject)=>dispatch(oneRemove(createdParentId, resolve, reject))) } catch {}
            throw error
        } finally {
            setSavingSuggestion(false)
        }
    }, [clearPending, collectionItems, dispatch, onChange])

    useEffect(()=>{
        if (!registerBeforeSave) return undefined
        return registerBeforeSave(persistPendingCollection)
    }, [persistPendingCollection, registerBeforeSave])

    const onSuggestionClick = useCallback(({ _id, title, parentId, category, key, confidence, confidenceTier, reason })=>{
        if (savingSuggestion) return
        if (selectedSuggestion?.key === key) {
            clearPending()
            setSelectedSuggestion(null)
            if (item.collectionId != originalCollectionId.current)
                onChange({ collectionId: originalCollectionId.current })
            return
        }

        const previousId = originalCollectionId.current
        setSelectedSuggestion({ key, previousId, confidence, confidenceTier, reason })
        if (_id) {
            clearPending()
            if (item.collectionId != _id)
                onChange({ collectionId: _id })
            return
        }

        pendingTitleRef.current = title
        pendingParentIdRef.current = parentId
        pendingCategoryRef.current = category || ''
        const parent = Number(parentId) > 0 ? collectionItems[parentId] : null
        setPendingLabel([parent?.title || category, title].filter(Boolean).join(' / '))
        if (item.collectionId != previousId)
            onChange({ collectionId: previousId })
    }, [clearPending, collectionItems, item.collectionId, onChange, savingSuggestion, selectedSuggestion])

    const onRestore = useCallback(()=>{
        if (savingSuggestion || !selectedSuggestion) return
        clearPending()
        setSelectedSuggestion(null)
        if (item.collectionId != originalCollectionId.current)
            onChange({ collectionId: originalCollectionId.current })
    }, [clearPending, item.collectionId, onChange, savingSuggestion, selectedSuggestion])

    const onSuggest = useCallback(()=>{
        if (suggesting) return
        onSuggestionError?.('')
        setSuggesting(true)
        dispatch(suggestFields(item, true,
            ()=>{
                setSuggesting(false)
                onSuggestionError?.('')
            },
            suggestionError=>{
                setSuggesting(false)
                onSuggestionError?.(suggestionError?.message || t.s('server'))
            },
            'collection'))
    }, [dispatch, item, onSuggestionError, suggesting])

    useEffect(()=>{
        originalCollectionId.current = item.collectionId
        clearPending()
        setSelectedSuggestion(null)
        onSuggestionError?.('')
    }, [clearPending, item._id, item.link])

    const canSuggest = aiEnabled && (pro || independentService)
    const displayPathText = pendingLabel || pathText

    return (
        <>
            <Label>{t.s('collection')}</Label>

            <div>
                <div className={s.field}>
                    <Button
                        ref={buttonRef}
                        href=''
                        variant='flat'
                        disabled={savingSuggestion}
                        onClick={onPickerClick}
                        title={displayPathText}>
                        <CollectionIcon {...(_.last(path)||{})} />
                        <span>{displayPathText || t.s('selectCollection')+'…'}</span>
                        <Icon name='arrow' />
                    </Button>
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
                    {selectedSuggestion && <Button
                        as='button'
                        type='button'
                        variant='link'
                        size='small'
                        title={t.s('aiRestore')}
                        aria-label={t.s('aiRestore')}
                        disabled={savingSuggestion}
                        onClick={onRestore}>
                        <Icon name='refresh' />
                    </Button>}
                </div>

                <Suggested
                    item={item}
                    events={pickerEvents}
                    selected={selectedSuggestion}
                    onSuggestionClick={onSuggestionClick}
                    saving={savingSuggestion} />
            </div>

            {pick && (
                <Picker
                    activeId={item.collectionId}
                    events={pickerEvents}
                    onClose={onPickerClose} />
            )}
        </>
    )
}

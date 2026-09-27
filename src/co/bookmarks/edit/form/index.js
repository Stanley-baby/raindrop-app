import s from './index.module.styl'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import t from '~t'
import { suggestFields } from '~data/actions/bookmarks'

import { Layout, Separator, Group } from '~co/common/form'
import Cover from './cover'
import Note from './note'
import Collection from './collection'
import Tags from './tags'
import Action from './action'
import Title from './title'
import Link from './link'
import Reminder from './reminder'
import Important from './important'
import Date from './date'
import Button from '~co/common/button'

export default function BookmarkEditForm(props) {
    const dispatch = useDispatch()
    const beforeSaveRef = useRef(null)
    const savePromiseRef = useRef(null)
    const latestItemRef = useRef(props.item)
    const [suggestionError, setSuggestionError] = useState('')
    latestItemRef.current = props.item

    const registerBeforeSave = useCallback(handler=>{
        beforeSaveRef.current = handler || null
    }, [])

    const onSave = useCallback(()=>{
        if (savePromiseRef.current)
            return savePromiseRef.current

        const pending = (async()=>{
            const rollback = await beforeSaveRef.current?.()
            try {
                return await props.onSave()
            } catch (error) {
                try { await rollback?.() } catch {}
                throw error
            }
        })()
        savePromiseRef.current = pending
        return pending.finally(()=>{
            if (savePromiseRef.current === pending)
                savePromiseRef.current = null
        })
    }, [props.onSave])

    useEffect(()=>{
        props.registerFormSave?.(onSave)
    }, [onSave, props.registerFormSave])

    const formProps = { ...props, onSave }

    //load suggestions
    useEffect(()=>{
        const original = props.item
        dispatch(suggestFields(original, false, ({ normalizedTitle, note })=>{
            if (props.status != 'new') return
            const current = latestItemRef.current
            const changes = {}
            if (normalizedTitle && current.title == original.title) changes.title = normalizedTitle
            if (note && !String(current.note || '').trim()) changes.note = note
            if (Object.keys(changes).length) props.onChange(changes)
        }))
    }, [props.item._id, props.item.link])

    useEffect(()=>setSuggestionError(''), [props.item._id, props.item.link])

    const onSubmitForm = useCallback(e=>{
        e.preventDefault()
        e.stopPropagation()
        
        onSave().then(()=>{
            if (props.autoWindowClose)
                window.close()
        })
    }, [onSave, props.autoWindowClose])

    return (
        <form 
            className={s.form}
            data-status={props.status}
            onSubmit={onSubmitForm}>
            <Layout type='grid'>
                <Cover {...formProps} />
                <Title  {...formProps} />
                <Note {...formProps} />
                {suggestionError && <>
                    <div />
                    <div className={s.error} role='alert'>
                        <span>{suggestionError}</span>
                        <Button href='/settings/app#ai-model' variant='link' size='small'>{t.s('aiModelChange')}</Button>
                        <Button href='/settings/app#ai-usage' variant='link' size='small'>{t.s('aiGateway')}</Button>
                    </div>
                </>}
                
                <Collection {...formProps} registerBeforeSave={registerBeforeSave} onSuggestionError={setSuggestionError} />
                <Tags {...formProps} onSuggestionError={setSuggestionError} />
                <Link {...formProps} />

                <div />
                <Group>
                    <Important {...formProps} />
                    <Reminder {...formProps} />
                </Group>
                
                <Date {...formProps} />

                <Separator variant='transparent' />
                
                <Action {...formProps} />
            </Layout>
        </form>
    )
}

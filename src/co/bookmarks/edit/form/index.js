import s from './index.module.styl'
import React, { useCallback, useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
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

export default function BookmarkEditForm(props) {
    const dispatch = useDispatch()
    const beforeSaveRef = useRef(null)
    const savePromiseRef = useRef(null)

    const registerBeforeSave = useCallback(handler=>{
        beforeSaveRef.current = handler || null
        return ()=>{
            if (beforeSaveRef.current === handler)
                beforeSaveRef.current = null
        }
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

    const formProps = { ...props, onSave }

    //load suggestions
    useEffect(()=>
        { dispatch(suggestFields(props.item)) },
        [props.item._id, props.item.link]
    )

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
                
                <Collection {...formProps} registerBeforeSave={registerBeforeSave} />
                <Tags {...formProps} />
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

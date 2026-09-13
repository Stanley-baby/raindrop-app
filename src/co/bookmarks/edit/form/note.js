import s from './note.module.styl'
import t from '~t'
import React, { useCallback, useState } from 'react'
import links from '~config/links'

import { Text, Label } from '~co/common/form'
import Icon from '~co/common/icon'
import Button from '~co/common/button'
import { Confirm } from '~co/overlay/dialog'
import Ai from './ai'

export default function BookmarkEditFormNote({ autoFocus, item, onCommit, onChange, status }) {
    const { note } = item
    const [aiLoading, setAiLoading] = useState(false)
    const onChangeField = useCallback(e=>
        onChange({ [e.target.getAttribute('name')]: e.target.value }),
        []
    )

    const onMarkdownClick = useCallback(e=>{
        e.preventDefault()
        Confirm(t.s('note'), {
            description: t.s('markdownSupported'),
            cancel: t.s('howToUse')
        }).then(ok=>{
            if (!ok)
                window.open(links.help['add-note'])
        })
    }, [])

    return (
        <>
            <Label>{t.s('note')}</Label>
            <div className={s.field}>
                <Ai item={item} onChange={onChange} onLoadingChange={setAiLoading} status={status} />
                <Text
                    className={s.note + (aiLoading && !String(note || '').trim() ? ' '+s.generating : '')}
                    type='text'
                    autoFocus={autoFocus=='note'}
                    name='note'
                    value={note}
                    autoSize={true}
                    multiline={true}
                    minRows={3}
                    onChange={onChangeField}
                    onBlur={onCommit}>
                    {aiLoading && !String(note || '').trim() && <div className={s.loading} role='status' aria-live='polite'>
                        <Icon name='ai' />
                        <span>{t.s('aiGenerating')}</span>
                        <i aria-hidden='true' />
                    </div>}
                    <Button
                        className={s.button}
                        onClick={onMarkdownClick}
                        tabIndex='-1'
                        size='small'
                        title={t.s('markdownSupported')}>
                        <Icon name='markdown' />
                    </Button>
                </Text>
            </div>
        </>
    )
}

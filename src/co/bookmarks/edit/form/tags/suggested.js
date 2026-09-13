import s from './suggested.module.styl'
import React, { useState, useMemo, useCallback } from 'react'
import t from '~t'
import { useSelector } from 'react-redux'
import { makeSuggestedFields } from '~data/selectors/bookmarks'
import { isPro } from '~data/selectors/user'
import { independentService } from '~config/environment'

import Icon from '~co/common/icon'
import Button from '~co/common/button'

function Suggestion({ tag, isNew=false, selected=false, disabled=false, onClick }) {
    return (
        <Button 
            data-tag={tag}
            className={s.suggestion}
            variant='dotted'
            data-shape='pill'
            data-is-new={isNew}
            data-selected={selected}
            disabled={disabled}
            size='small'
            tabIndex='-1'
            onClick={onClick}>
            {isNew?<Icon name='add' size='micro' />:null}{tag}
        </Button>
    )
}

export default function BookmarkEditFormTagsSuggested({ item, onTagClick, selectedTags={}, saving=false }) {
    //get suggestions
    const enabled = useSelector(state=>state.config.ai_suggestions)
    const pro = useSelector(state=>isPro(state))
    const getSuggestedFields = useMemo(()=>makeSuggestedFields(), [])
    const { tags, new_tags, tags_status='' } = useSelector(state=>getSuggestedFields(state, item))

    //expand
    const [expanded, setExpanded] = useState(false)
    const onMouseOver = useCallback(()=>setExpanded(true), [])

    //click
    const onSuggestionClick = useCallback(e=>{
        const tag = e.currentTarget.getAttribute('data-tag')
        onTagClick(tag)
    }, [onTagClick])

    if (!enabled || !pro && !independentService)
        return null

    return (
        <div
            className={s.suggested}
            data-expanded={expanded}
            title={t.s('suggestedTags')}
            onMouseOver={onMouseOver}>            
            {tags.map(tag=>(
                <Suggestion 
                    key={tag} 
                    tag={tag} 
                    selected={Boolean(selectedTags[tag])}
                    disabled={saving}
                    onClick={onSuggestionClick} />
            ))}
            {new_tags.map(tag=>(
                <Suggestion 
                    key={tag} 
                    tag={tag}
                    isNew={true}
                    selected={Boolean(selectedTags[tag])}
                    disabled={saving}
                    onClick={onSuggestionClick} />
            ))}
            {!tags.length && !new_tags.length && tags_status === 'no_match' && <span className={s.empty} role='status' aria-live='polite'>{t.s('nothingFound')}</span>}
        </div>
    )
}

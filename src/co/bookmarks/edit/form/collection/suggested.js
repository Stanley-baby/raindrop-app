import s from './suggested.module.styl'
import React, { useState, useMemo, useCallback } from 'react'
import t from '~t'
import { useSelector } from 'react-redux'
import { makeSuggestedFields } from '~data/selectors/bookmarks'
import { makeCollectionPath } from '~data/selectors/collections'
import { isPro } from '~data/selectors/user'
import { independentService } from '~config/environment'

import Button from '~co/common/button'

const self = { self: true }

function Suggestion({ id, parentId, title, category, isNew=false, confidence, confidenceTier, reason, selected=false, disabled=false, onClick }) {
    const getCollectionPath = useMemo(()=>makeCollectionPath(), [])
    const path = useSelector(state=>getCollectionPath(state, id, self))
    const parentPath = useSelector(state=>getCollectionPath(state, parentId, self))
    const shortPath = useMemo(()=>path.map((p)=>p.title).slice(-2).join(' / '), [path])
    const fullPath = useMemo(()=>path.map((p)=>p.title).join(' / '), [path])
    const parentPathText = useMemo(()=>parentPath.map((p)=>p.title).join(' / '), [parentPath])
    const collection = useMemo(()=>path?.[path.length-1], [path])
    const newPath = [parentPathText || category, title].filter(Boolean).join(' / ')
    const label = isNew ? newPath : shortPath
    const tier = confidenceTier || (confidence === 'high' || confidence >= 0.8 ? 'high' : confidence === 'medium' || confidence >= 0.55 ? 'medium' : 'low')
    const confidenceLabel = tier === 'high' ? t.s('aiConfidenceHigh') : tier === 'medium' ? t.s('aiConfidenceMedium') : t.s('aiConfidenceLow')
    const confidenceValue = Number.isFinite(Number(confidence)) ? Math.round(Math.max(0, Math.min(1, Number(confidence))) * 100) :
        confidenceTier ? ({ high: 90, medium: 65, low: 35 }[tier] || 0) : null
    const explanation = reason || (isNew ? t.s('aiCollectionSuggestedReason') : '')

    if (!isNew && !collection?.title || isNew && !title)
        return null

    return (
        <Button
            data-id={id || undefined}
            data-title={title || undefined}
            className={s.suggestion}
            data-is-new={isNew}
            data-selected={selected}
            data-confidence={confidenceValue == null ? undefined : tier}
            disabled={disabled}
            data-tint={collection?.color || undefined}
            style={{'--tint': isNew ? 'var(--accent-color)' : collection?.color}}
            variant='dotted'
            data-shape='pill'
            size='small'
            tabIndex='-1'
            title={[isNew ? label : fullPath, explanation].filter(Boolean).join(' · ')}
            onClick={onClick}>
            {isNew && <span aria-hidden='true'>＋</span>}
            <div className={s.path}><span>{label}</span></div>
            {confidenceValue != null && <span
                className={s.confidence}
                title={reason || confidenceLabel}
                aria-label={confidenceLabel}>
                <span className={s.meter} style={{ '--confidence': confidenceValue + '%' }} />
                <span>{confidenceLabel}</span>
            </span>}
        </Button>
    )
}

export default function BookmarkEditFormCollectionSuggested({ item, events: { onItemClick }, selected, onSuggestionClick, saving=false }) {
    //get suggestions
    const enabled = useSelector(state=>state.config.ai_suggestions)
    const pro = useSelector(state=>isPro(state))
    const getSuggestedFields = useMemo(()=>makeSuggestedFields(), [])
    const { collections=[], new_collections=[], create_suggestions=[], collection_recommendations=[], collection_status='' } = useSelector(state=>getSuggestedFields(state, item))
    const recommendations = (collection_recommendations.length ? collection_recommendations : [
        ...collections.map(id=>({ id, kind: 'existing' })),
        ...create_suggestions.map(item=>typeof item === 'object' ? { ...item, kind: item.kind || 'new' } : ({ title: item, kind: 'new' })),
        ...new_collections.map(title=>({ title, kind: 'new' }))
    ]).map(recommendation=>typeof recommendation === 'object' ? recommendation : ({ id: recommendation, kind: 'existing' }))

    //expand
    const [expanded, setExpanded] = useState(false)
    const onMouseOver = useCallback(()=>setExpanded(true), [])

    const onRecommendationClick = useCallback(recommendation=>{
        const isNew = recommendation.kind === 'new' || recommendation.isNew
        const id = recommendation.id ?? recommendation._id
        const title = recommendation.title
        const key = isNew ? 'new-collection:' + title : 'collection:' + id
        const details = {
            key,
            confidence: recommendation.confidence,
            confidenceTier: recommendation.confidenceTier || recommendation.tier,
            reason: recommendation.reason,
            parentId: recommendation.parentId ?? recommendation.parent_id,
            category: recommendation.category
        }
        if (isNew)
            onSuggestionClick?.({ title, ...details })
        else if (onSuggestionClick)
            onSuggestionClick({ _id: id, ...details })
        else
            onItemClick({ _id: id })
    }, [onItemClick, onSuggestionClick])

    if (!enabled || !pro && !independentService)
        return null

    return (
        <div 
            className={s.suggested} 
            data-expanded={expanded}
            data-is-new={item.collectionId <= 0}
            title={t.s('aiSuggestionContextHelp')}
            onMouseOver={onMouseOver}>
            {recommendations.map((recommendation, index)=>{
                const isNew = recommendation.kind === 'new' || recommendation.isNew
                const id = recommendation.id ?? recommendation._id
                const title = recommendation.title
                const key = isNew ? 'new-collection:' + title : 'collection:' + id
                return <Suggestion
                    key={key || index}
                    id={id}
                    parentId={recommendation.parentId ?? recommendation.parent_id}
                    title={title}
                    category={recommendation.category}
                    isNew={isNew}
                    confidence={recommendation.confidence}
                    confidenceTier={recommendation.confidenceTier || recommendation.tier}
                    reason={recommendation.reason}
                    selected={selected?.key === key}
                    disabled={saving}
                    onClick={()=>onRecommendationClick(recommendation)} />
            })}
            {!recommendations.length && collection_status && <span className={s.empty} role='status' aria-live='polite'>{collection_status == 'no_match' ? t.s('noMatchingCollection') : t.s('nothingFound')}</span>}
        </div>
    )
}

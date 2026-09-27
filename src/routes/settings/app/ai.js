import s from './ai.module.styl'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import t from '~t'
import { Link } from 'react-router-dom'
import { connect } from 'react-redux'
import { set } from '~data/actions/config'
import { DEFAULT_AI_COLLECTION_PROMPT, DEFAULT_AI_NOTE_PROMPT, DEFAULT_AI_TAG_PROMPT } from '~data/constants/ai'
import { API_ORIGIN } from '~data/constants/app'
import { isPro } from '~data/selectors/user'
import config from '~config'

import { Label, Checkbox, SubLabel, Text } from '~co/common/form'
import Button from '~co/common/button'

const readJson = async response => {
    try { return await response.json() } catch { return {} }
}

const fetchAi = (path, options = {}) => fetch(API_ORIGIN + path, {
    credentials: 'include',
    cache: 'no-store',
    ...options
})

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0

const modelTask = task => ({
    'Text Generation': t.s('aiModelTaskTextGeneration'),
    'Text Embeddings': t.s('aiModelTaskEmbeddings')
}[task] || task)

function UsageChart ({ history, label }) {
    const [active, setActive] = useState(null)
    const width = 560
    const height = 168
    const inset = 12
    const values = history.map(item => number(item.requests) || number(item.cost))
    const max = Math.max(1, ...values)
    const points = history.map((item, index) => ({
        ...item,
        value: values[index],
        x: history.length === 1 ? width / 2 : inset + index * (width - inset * 2) / (history.length - 1),
        y: height - inset - values[index] / max * (height - inset * 2)
    }))
    const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
    const area = points.length ? `${line} L ${points[points.length - 1].x} ${height - inset} L ${points[0].x} ${height - inset} Z` : ''
    const selected = active === null ? null : points[active]

    const selectNearest = event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const x = (event.clientX - bounds.left) / bounds.width * width
        setActive(points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0))
    }

    return <div className={s.chart} aria-label={label}>
        <svg viewBox={`0 0 ${width} ${height}`} role='img' onMouseMove={selectNearest} onMouseLeave={() => setActive(null)}>
            <title>{label}</title>
            {[.25, .5, .75, 1].map(value => <line key={value} className={s.chartGrid} x1={inset} x2={width - inset} y1={height - inset - value * (height - inset * 2)} y2={height - inset - value * (height - inset * 2)} />)}
            <path className={s.chartArea} d={area} />
            <path className={s.chartLine} d={line} />
            {points.map((point, index) => <circle
                key={point.date || point.id || index}
                className={active === index ? s.chartPointActive : s.chartPoint}
                cx={point.x}
                cy={point.y}
                r={active === index ? 5 : 7}
                tabIndex='0'
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}>
                <title>{point.date}: {point.value}</title>
            </circle>)}
            {selected && <line className={s.chartGuide} x1={selected.x} x2={selected.x} y1={inset} y2={height - inset} />}
        </svg>
        {selected && <div className={s.chartTooltip} style={{ left: `${selected.x / width * 100}%` }} role='status'>
            <strong>{selected.date}</strong>
            <span>{t.s('aiGatewayRequests')}: {number(selected.requests)}</span>
            <span>{t.s('aiGatewayTokens')}: {number(selected.tokensIn) + number(selected.tokensOut)}</span>
            <span>{t.s('aiGatewayCredits')}: {number(selected.cost).toFixed(4)}</span>
        </div>}
        <div className={s.chartAxis} aria-hidden='true'>
            <span>{points[0]?.date?.slice(5)}</span>
            <span>{points[Math.floor((points.length - 1) / 2)]?.date?.slice(5)}</span>
            <span>{points[points.length - 1]?.date?.slice(5)}</span>
        </div>
    </div>
}

function PromptEditor ({ id, title, help, value, maxLength, height, optimizing, onChange, onBlur, onOptimize, onRestore, onResize }) {
    return <div className={s.promptEditor}>
        <div className={s.modelRow}>
            <Label>{title}</Label>
            <span className={s.meta}>{value.length}/{maxLength}</span>
        </div>
        <div className={s.promptText} style={{ height }} onPointerUp={event => onResize(event.currentTarget.offsetHeight)}>
            <Text
                autoSize
                multiline
                maxLength={maxLength}
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                aria-label={title}
                id={id} />
        </div>
        <SubLabel>{help}</SubLabel>
        <div className={s.promptActions}>
            <Button as='button' type='button' variant='primary' onClick={onOptimize} disabled={Boolean(optimizing)}>
                {optimizing ? t.s('aiPromptOptimizing') : t.s('aiPromptOptimize')}
            </Button>
            <Button as='button' type='button' variant='link' onClick={onRestore} disabled={Boolean(optimizing)}>{t.s('aiPromptRestore')}</Button>
        </div>
    </div>
}

function SettingsAppAi ({
    ai_suggestions,
    ai_assistant,
    ai_collection_prompt,
    ai_note_prompt,
    ai_note_thinking,
    ai_tag_prompt,
    ai_workers_model,
    ai_thinking_enabled,
    ai_thinking_level,
    isPro,
    set
}) {
    const [collectionPrompt, setCollectionPrompt] = useState(ai_collection_prompt || DEFAULT_AI_COLLECTION_PROMPT)
    const [notePrompt, setNotePrompt] = useState(ai_note_prompt || DEFAULT_AI_NOTE_PROMPT)
    const [tagPrompt, setTagPrompt] = useState(ai_tag_prompt || DEFAULT_AI_TAG_PROMPT)
    const [catalog, setCatalog] = useState(null)
    const [aiConfig, setAiConfig] = useState(null)
    const [quota, setQuota] = useState(null)
    const [custom, setCustom] = useState(null)
    const [providerEndpoint, setProviderEndpoint] = useState('')
    const [providerModel, setProviderModel] = useState('')
    const [providerReasoningMode, setProviderReasoningMode] = useState('reasoning_effort')
    const [providerKey, setProviderKey] = useState('')
    const [providerSaving, setProviderSaving] = useState(false)
    const [providerError, setProviderError] = useState('')
    const [providerNotice, setProviderNotice] = useState('')
    const [promptProvider, setPromptProvider] = useState('workers_ai')
    const [activePrompt, setActivePrompt] = useState('collection')
    const [promptOptimizing, setPromptOptimizing] = useState('')
    const [promptPreview, setPromptPreview] = useState(null)
    const [promptError, setPromptError] = useState('')
    const [promptNotice, setPromptNotice] = useState('')
    const [dashboardError, setDashboardError] = useState('')
    const [authRequired, setAuthRequired] = useState(false)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [modelQuery, setModelQuery] = useState('')
    const [modelSaving, setModelSaving] = useState(false)
    const [modelError, setModelError] = useState('')
    const [promptHeight, setPromptHeight] = useState(224)

    useEffect(() => setCollectionPrompt(ai_collection_prompt || DEFAULT_AI_COLLECTION_PROMPT), [ai_collection_prompt])
    useEffect(() => setNotePrompt(ai_note_prompt || DEFAULT_AI_NOTE_PROMPT), [ai_note_prompt])
    useEffect(() => setTagPrompt(ai_tag_prompt || DEFAULT_AI_TAG_PROMPT), [ai_tag_prompt])

    const loadDashboard = useCallback(async refresh => {
        if (refresh) setRefreshing(true)
        else setLoading(true)
        try {
            const refreshQuery = '_refresh=' + Date.now()
            const [configResponse, modelsResponse, quotaResponse, providerResponse] = await Promise.all([
                fetchAi('/v2/ai/config?' + refreshQuery),
                fetchAi('/v2/ai/models?' + refreshQuery),
                fetchAi('/v2/ai/quota?days=30&' + refreshQuery),
                fetchAi('/v2/ai/provider?' + refreshQuery)
            ])
            const [configBody, modelsBody, quotaBody, providerBody] = await Promise.all([
                readJson(configResponse), readJson(modelsResponse), readJson(quotaResponse), readJson(providerResponse)
            ])
            const responses = [configResponse, modelsResponse, quotaResponse, providerResponse]
            const unauthorized = responses.some(response => response.status === 401)
            const failed = responses.find(response => !response.ok && response.status !== 401)
            setAuthRequired(unauthorized)
            setDashboardError(unauthorized ? t.s('aiLoginRequired') : failed ? t.s('aiSettingsUnavailable') : '')
            if (configResponse.ok) setAiConfig(configBody)
            if (modelsResponse.ok) setCatalog(modelsBody)
            if (quotaResponse.ok) setQuota(quotaBody.quota || null)
            if (providerResponse.ok) {
                const provider = providerBody.custom || null
                setCustom(provider)
                setProviderEndpoint(provider?.endpoint || '')
                setProviderModel(provider?.model || '')
                setProviderReasoningMode(provider?.reasoningMode || 'reasoning_effort')
            }
        } finally {
            if (refresh) setRefreshing(false)
            else setLoading(false)
        }
    }, [])

    useEffect(() => { loadDashboard() }, [loadDashboard])

    const saveCustomProvider = useCallback(async () => {
        if (providerSaving || !providerEndpoint.trim() || !providerModel.trim() || !providerKey.trim()) return
        setProviderSaving(true)
        setProviderError('')
        setProviderNotice('')
        try {
            const response = await fetchAi('/v2/ai/provider', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: providerEndpoint,
                    model: providerModel,
                    apiKey: providerKey,
                    reasoningMode: providerReasoningMode
                })
            })
            const body = await readJson(response)
            if (!response.ok) throw new Error(body.errorMessage || t.s('aiSettingsUnavailable'))
            setCustom(body.custom || null)
            setProviderKey('')
            setProviderNotice(t.s('aiCustomSaved'))
        } catch (error) {
            setProviderError(error.message)
        } finally {
            setProviderSaving(false)
        }
    }, [providerEndpoint, providerKey, providerModel, providerReasoningMode, providerSaving])

    const deleteCustomProvider = useCallback(async () => {
        if (providerSaving) return
        setProviderSaving(true)
        setProviderError('')
        setProviderNotice('')
        try {
            const response = await fetchAi('/v2/ai/provider', { method: 'DELETE' })
            const body = await readJson(response)
            if (!response.ok) throw new Error(body.errorMessage || t.s('aiSettingsUnavailable'))
            setCustom(null)
            setProviderEndpoint('')
            setProviderModel('')
            setProviderKey('')
            setProviderReasoningMode('reasoning_effort')
            setPromptProvider('workers_ai')
            setProviderNotice(t.s('aiCustomDeleted'))
        } catch (error) {
            setProviderError(error.message)
        } finally {
            setProviderSaving(false)
        }
    }, [providerSaving])

    const promptValues = { collection: collectionPrompt, tags: tagPrompt, note: notePrompt }
    const promptDefaults = { collection: DEFAULT_AI_COLLECTION_PROMPT, tags: DEFAULT_AI_TAG_PROMPT, note: DEFAULT_AI_NOTE_PROMPT }
    const promptConfigKeys = { collection: 'ai_collection_prompt', tags: 'ai_tag_prompt', note: 'ai_note_prompt' }
    const promptSetters = { collection: setCollectionPrompt, tags: setTagPrompt, note: setNotePrompt }

    const savePrompt = useCallback((field, value) => {
        const normalized = value.trim() || promptDefaults[field]
        promptSetters[field](normalized)
        set(promptConfigKeys[field], normalized)
    }, [set])

    const optimizePrompt = useCallback(async field => {
        if (promptOptimizing) return
        setPromptOptimizing(field)
        setPromptError('')
        setPromptNotice('')
        try {
            const response = await fetchAi('/v2/ai/prompt-optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    field,
                    prompt: promptValues[field],
                    language: t.currentLang,
                    provider: promptProvider
                })
            })
            const body = await readJson(response)
            if (!response.ok) throw new Error(body.errorMessage || t.s('aiSettingsUnavailable'))
            setPromptPreview({ field, original: promptValues[field], prompt: body.prompt, summary: body.summary || '' })
        } catch (error) {
            setPromptError(error.message)
        } finally {
            setPromptOptimizing('')
        }
    }, [notePrompt, collectionPrompt, promptOptimizing, promptProvider, tagPrompt])

    const applyPromptPreview = useCallback(() => {
        if (!promptPreview) return
        savePrompt(promptPreview.field, promptPreview.prompt)
        setPromptPreview(null)
        setPromptNotice(t.s('aiPromptSaved'))
    }, [promptPreview, savePrompt])

    const restorePrompt = useCallback(field => {
        savePrompt(field, promptDefaults[field])
        setPromptPreview(null)
        setPromptNotice(t.s('aiPromptRestored'))
    }, [savePrompt])

    const models = catalog?.models || []
    const selectedModel = ai_workers_model || aiConfig?.workersAi?.model || models.find(model => model.selectable !== false)?.id || ''
    const selectedInfo = useMemo(() => models.find(model => model.id === selectedModel) || {
        id: selectedModel,
        name: selectedModel,
        reasoning: false,
        selectable: true,
        task: 'Text Generation'
    }, [models, selectedModel])
    const selectModel = useCallback(async (model, target) => {
        if (modelSaving || model.id === selectedModel) return
        setModelSaving(true)
        setModelError('')
        try {
            const response = await fetchAi('/v2/ai/models/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: model.id })
            })
            const body = await readJson(response)
            if (!response.ok) throw new Error(body.errorMessage || t.s('aiSettingsUnavailable'))
            set('ai_workers_model', model.id)
            target.closest('details').removeAttribute('open')
        } catch (error) {
            setModelError(error.message)
        } finally {
            setModelSaving(false)
        }
    }, [modelSaving, selectedModel, set])
    const thinkingEnabled = typeof ai_thinking_enabled === 'boolean' ? ai_thinking_enabled : Boolean(ai_note_thinking)
    const thinkingLevel = ['low', 'medium', 'high'].includes(ai_thinking_level) ? ai_thinking_level : 'medium'
    const history = quota?.history?.length
        ? quota.history
        : (quota?.billingHistory || []).map(item => ({ date: new Date(item.startAt).toISOString().slice(0, 10), requests: 0, cost: item.value }))
    const visibleModels = models.filter(model => `${model.name || ''} ${model.id || ''} ${model.task || ''}`.toLowerCase().includes(modelQuery.trim().toLowerCase()))
    const gatewayConfigured = Boolean(quota?.gateway?.configured ?? quota?.gateway?.usageAvailable)
    const gatewayError = quota?.errors?.[0]
    const promptTabs = [
        { key: 'collection', tabTitle: t.s('aiPromptTabCollection'), title: t.s('aiCollectionPrompt'), help: t.s('aiCollectionPromptHelp'), maxLength: 2000 },
        { key: 'tags', tabTitle: t.s('aiPromptTabTags'), title: t.s('aiTagPrompt'), help: t.s('aiTagPromptHelp'), maxLength: 2000 },
        { key: 'note', tabTitle: t.s('aiPromptTabNote'), title: t.s('aiNotePrompt'), help: t.s('aiNotePromptHelp'), maxLength: 4000 }
    ]
    const activePromptTab = promptTabs.find(item => item.key === activePrompt) || promptTabs[0]
    const selectPromptTab = (event, index) => {
        let next = index
        if (event.key === 'ArrowRight') next = (index + 1) % promptTabs.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + promptTabs.length) % promptTabs.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = promptTabs.length - 1
        else return
        event.preventDefault()
        setActivePrompt(promptTabs[next].key)
        event.currentTarget.parentElement.children[next].focus()
    }

    return (
        <>
            <section className={`${s.card} ${s.featureCard}`} aria-label='AI'>
                <div className={s.cardHeader}>
                    <div>
                        <h2>AI</h2>
                        <SubLabel>{t.s('aiDescription')}</SubLabel>
                    </div>
                </div>
                <div className={s.featureGrid}>
                    <div className={s.featureItem}>
                        <Checkbox
                            checked={ai_assistant}
                            onChange={() => set('ai_assistant', !ai_assistant)}>
                            {t.s('ask')} AI
                            <a href={config.links.help.stella.index} target='_blank'>[?]</a>
                        </Checkbox>
                        <SubLabel>{t.s('aiDescription')}</SubLabel>
                    </div>
                    <div className={s.featureItem}>
                        <Checkbox
                            checked={ai_suggestions}
                            onChange={() => set('ai_suggestions', !ai_suggestions)}>
                            {t.s('suggestedCollectionsAndTags')}
                        </Checkbox>
                        <SubLabel>
                            {!isPro && <>Only available for <Link to='/settings/pro'>Pro</Link>. </>}
                            {t.s('aiDescription')}
                        </SubLabel>
                    </div>
                </div>
            </section>

            <section id='ai-model' className={s.card} aria-label={t.s('aiModelCatalog')}>
                <div className={s.cardHeader}>
                    <div>
                        <h2>{t.s('aiModelCatalog')}</h2>
                        <SubLabel>{t.s('aiModelSelect')}</SubLabel>
                    </div>
                </div>
                {dashboardError && <div className={s.warning} role='alert'>
                    {dashboardError}
                    {authRequired && <> · <Link to='/account/login'>{t.s('signIn')}</Link></>}
                </div>}
                {loading ? <SubLabel>{t.s('aiModelLoading')}</SubLabel> : <>
                    <details className={s.modelPicker}>
                        <summary className={s.modelSummary}>
                            <div className={s.modelIdentity}>
                                <div className={s.modelTitle}>
                                    <strong>{selectedInfo.name || selectedInfo.id}</strong>
                                    <div className={s.modelBadges}>
                                        {selectedInfo.task && <span className={s.badge}>{modelTask(selectedInfo.task)}</span>}
                                        {selectedInfo.reasoning && <span className={s.reasoningBadge}>{t.s('aiModelReasoning')}</span>}
                                    </div>
                                </div>
                                {selectedInfo.id && <div className={s.modelId} title={selectedInfo.id}>{selectedInfo.id}</div>}
                            </div>
                            <span className={s.modelChange}>{t.s('aiModelChange')}</span>
                        </summary>
                        <div className={s.modelMenu}>
                            <input
                                className={s.input}
                                type='search'
                                value={modelQuery}
                                onChange={event => setModelQuery(event.target.value)}
                                placeholder={t.s('aiModelSearch')}
                                aria-label={t.s('aiModelSearch')} />
                            <div className={s.modelList}>
                                {visibleModels.map(model => <button
                                    type='button'
                                    className={s.modelOption}
                                    data-selected={model.id === selectedModel}
                                    key={model.id}
                                    disabled={model.selectable === false || modelSaving}
                                    onClick={event => {
                                        selectModel(model, event.currentTarget)
                                    }}>
                                    <span><strong>{model.name || model.id}</strong><small>{model.id}</small></span>
                                    <span className={s.modelBadges}>
                                        {model.task && <span className={s.badge}>{modelTask(model.task)}</span>}
                                        {model.reasoning && <span className={s.reasoningBadge}>{t.s('aiModelReasoning')}</span>}
                                        {model.paidOnly && <span className={s.badge}>{t.s('aiPaidModel')}</span>}
                                        {model.id === selectedModel && <span className={s.modelCheck} aria-label={t.s('aiModelCurrent')}>✓</span>}
                                    </span>
                                </button>)}
                            </div>
                        </div>
                    </details>
                    {catalog?.errorCode
                        ? <SubLabel>{t.s('aiModelRetry')}</SubLabel>
                        : !catalog?.configured && <SubLabel>{t.s('aiModelUnavailable')}</SubLabel>}
                    {modelError && <div className={s.warning} role='alert'>{modelError}</div>}
                </>}

                {selectedInfo.reasoning && <div className={s.thinkingRow}>
                    <div>
                        <Checkbox
                            checked={thinkingEnabled}
                            onChange={() => set({ ai_thinking_enabled: !thinkingEnabled, ai_note_thinking: !thinkingEnabled })}>
                            {t.s('aiThinking')}
                        </Checkbox>
                        <SubLabel>{t.s('aiModelReasoning')}</SubLabel>
                    </div>
                    {thinkingEnabled && <div className={s.thinkingLevel}>
                        <span>{t.s('aiThinkingLevel')}</span>
                        <div className={s.segmented} role='group' aria-label={t.s('aiThinkingLevel')}>
                            {[
                                ['low', t.s('aiThinkingLevelLow')],
                                ['medium', t.s('aiThinkingLevelMedium')],
                                ['high', t.s('aiThinkingLevelHigh')]
                            ].map(([value, label]) => <button
                                type='button'
                                key={value}
                                aria-pressed={thinkingLevel === value}
                                onClick={() => set('ai_thinking_level', value)}>{label}</button>)}
                        </div>
                    </div>}
                </div>}
            </section>

            <details className={`${s.card} ${s.disclosure}`} aria-label={t.s('aiCustomModel')}>
                <summary className={s.disclosureSummary}>
                    <div className={s.disclosureLead}>
                        <span className={s.customIcon} aria-hidden='true'>API</span>
                        <div>
                            <h2>{t.s('aiCustomModel')}</h2>
                            <SubLabel>{t.s('aiCustomDescription')}</SubLabel>
                        </div>
                    </div>
                    <div className={s.disclosureStatus}>
                        <span className={custom?.configured ? s.statusDotActive : s.statusDot} aria-hidden='true' />
                        <span className={s.customStatus} title={custom?.model}>{custom?.configured ? custom.model : t.s('aiCustomNotConfigured')}</span>
                        <span className={s.disclosureAction}>{t.s('aiCustomConfigure')}</span>
                        <svg className={s.chevron} aria-hidden='true' width='16' height='16' viewBox='0 0 16 16'><path d='m4 6 4 4 4-4' /></svg>
                    </div>
                </summary>
                <div className={s.disclosureBody}>
                    <div className={s.customForm}>
                        <label className={s.customField}>
                            <span>{t.s('aiCustomEndpoint')}</span>
                            <input className={s.input} value={providerEndpoint} onChange={event => setProviderEndpoint(event.target.value)} placeholder='https://provider.example/v1' aria-label={t.s('aiCustomEndpoint')} />
                        </label>
                        <label className={s.customField}>
                            <span>{t.s('aiCustomModelName')}</span>
                            <input className={s.input} value={providerModel} onChange={event => setProviderModel(event.target.value)} placeholder='Model' aria-label={t.s('aiCustomModelName')} />
                        </label>
                        <label className={s.customField}>
                            <span>{t.s('aiCustomApiKey')}</span>
                            <input className={s.input} type='password' value={providerKey} onChange={event => setProviderKey(event.target.value)} placeholder={custom?.configured ? t.s('aiCustomReplaceKey') : t.s('aiCustomApiKey')} aria-label={t.s('aiCustomApiKey')} autoComplete='off' />
                        </label>
                        <label className={s.customField}>
                            <span>{t.s('aiCustomReasoning')}</span>
                            <select className={s.select} value={providerReasoningMode} onChange={event => setProviderReasoningMode(event.target.value)} aria-label={t.s('aiCustomReasoning')}>
                                <option value='unsupported'>Unsupported</option>
                                <option value='reasoning_effort'>reasoning_effort</option>
                                <option value='chat_template_kwargs.enable_thinking'>chat_template_kwargs.enable_thinking</option>
                                <option value='chat_template_kwargs.thinking'>chat_template_kwargs.thinking</option>
                            </select>
                        </label>
                    </div>
                    <SubLabel>{t.s('aiCustomReasoningHint')}</SubLabel>
                    {providerError && <div className={s.warning} role='alert'>{providerError}</div>}
                    {providerNotice && <SubLabel role='status'>{providerNotice}</SubLabel>}
                    <div className={s.customActions}>
                        <Button as='button' type='button' variant='primary' onClick={saveCustomProvider} disabled={providerSaving || !providerEndpoint.trim() || !providerModel.trim() || !providerKey.trim()}>
                            {providerSaving ? t.s('loading') : t.s('aiCustomSave')}
                        </Button>
                        {custom?.configured && <Button as='button' type='button' variant='link' accent='danger' onClick={deleteCustomProvider} disabled={providerSaving}>{t.s('remove')}</Button>}
                    </div>
                </div>
            </details>

            <section id='ai-usage' className={s.card} aria-label={t.s('aiGateway')}>
                <div className={s.cardHeader}>
                    <div>
                        <h2>{t.s('aiGateway')}</h2>
                        <SubLabel>{t.s('aiWorkersFreeAllocation')}</SubLabel>
                    </div>
                    <Button as='button' type='button' variant='link' onClick={() => loadDashboard(true)} disabled={refreshing}>
                        {refreshing ? t.s('loading') : t.s('aiGatewayRefresh')}
                    </Button>
                </div>
                {!gatewayConfigured ? <SubLabel>{t.s('aiGatewayConfigure')}</SubLabel> : <>
                    {quota?.warning && <div className={s.warning} role='alert'>{t.s('aiGatewayLowBalance')}</div>}
                    {gatewayError && <SubLabel>{gatewayError}</SubLabel>}
                    <div className={s.summary}>
                        <div className={s.stat}><small>{t.s('aiGatewayBalance')}</small><strong>{quota.balance === null ? '—' : quota.balance.toFixed(2)}</strong></div>
                        <div className={s.stat}><small>{t.s('aiGatewayRequests')}</small><strong>{number(quota.usage?.requests)}</strong></div>
                        <div className={s.stat}><small>{t.s('aiGatewayTokens')}</small><strong>{number(quota.usage?.tokensIn) + number(quota.usage?.tokensOut)}</strong></div>
                        <div className={s.stat}><small>{t.s('aiGatewayCredits')}</small><strong>{number(quota.usage?.cost).toFixed(4)}</strong></div>
                    </div>

                    <div className={s.sectionTitle}>{t.s('aiGatewayHistory')}</div>
                    {history.length ? <UsageChart history={history} label={t.s('aiGatewayHistory')} /> : <SubLabel>{t.s('aiGatewayNoData')}</SubLabel>}

                    <div className={s.sectionTitle}>{t.s('aiGatewayModels')}</div>
                    {quota.byModel?.length ? <div className={s.tableWrap}><table className={s.table}>
                        <thead><tr><th>{t.s('aiModel')}</th><th>{t.s('aiGatewayRequests')}</th><th>{t.s('aiGatewayTokens')}</th><th>{t.s('aiGatewayCredits')}</th></tr></thead>
                        <tbody>{quota.byModel.map(item => <tr key={item.model}>
                            <td>{item.model}</td>
                            <td>{item.requests}</td>
                            <td>{number(item.tokensIn) + number(item.tokensOut)}</td>
                            <td>{number(item.cost).toFixed(4)}</td>
                        </tr>)}</tbody>
                    </table></div> : <SubLabel>{t.s('aiGatewayNoData')}</SubLabel>}
                    {quota.fetchedAt && <SubLabel>{t.s('aiGatewayUpdated')}: {new Date(quota.fetchedAt).toLocaleString()}</SubLabel>}
                </>}
            </section>

            <section className={`${s.card} ${s.promptSettings}`} aria-label={t.s('aiPromptSettings')}>
                <div className={s.cardHeader}>
                    <div>
                        <h2>{t.s('aiPromptSettings')}</h2>
                        <SubLabel>{t.s('aiPromptSettingsHelp')}</SubLabel>
                    </div>
                    <div className={s.providerSelect}>
                        <span>{t.s('aiPromptProvider')}</span>
                        {custom?.configured ? <details className={s.providerPicker}>
                            <summary className={s.providerControl}>
                                <span className={s.statusDotActive} aria-hidden='true' />
                                <span>{promptProvider === 'custom' ? t.s('aiCustomProvider') : t.s('aiWorkersProvider')}</span>
                                <svg width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'><path d='m3 4.5 3 3 3-3' /></svg>
                            </summary>
                            <div className={s.providerMenu}>
                                {[['workers_ai', t.s('aiWorkersProvider')], ['custom', t.s('aiCustomProvider')]].map(([value, label]) => <button
                                    type='button'
                                    key={value}
                                    aria-pressed={promptProvider === value}
                                    onClick={event => {
                                        setPromptProvider(value)
                                        event.currentTarget.closest('details').open = false
                                    }}>
                                    <span>{label}</span>
                                    {promptProvider === value && <span className={s.modelCheck}>✓</span>}
                                </button>)}
                            </div>
                        </details> : <span className={`${s.providerControl} ${s.providerStatic}`}>
                            <span className={s.statusDotActive} aria-hidden='true' />
                            <span>{t.s('aiWorkersProvider')}</span>
                        </span>}
                        <small>{t.s('aiPromptProviderHint')}</small>
                    </div>
                </div>
                {promptError && <div className={s.warning} role='alert'>{promptError}</div>}
                {promptNotice && <SubLabel role='status'>{promptNotice}</SubLabel>}

                <div className={s.promptTabs} role='tablist' aria-label={t.s('aiPromptSettings')}>
                    {promptTabs.map((item, index) => <Button
                        as='button'
                        type='button'
                        key={item.key}
                        variant={activePrompt === item.key ? 'active' : 'default'}
                        role='tab'
                        aria-selected={activePrompt === item.key}
                        aria-controls={`ai-${item.key}-prompt`}
                        tabIndex={activePrompt === item.key ? 0 : -1}
                        onKeyDown={event => selectPromptTab(event, index)}
                        onClick={() => setActivePrompt(item.key)}>
                        {item.tabTitle}
                    </Button>)}
                </div>

                <div className={s.promptPanel} role='tabpanel' id={`ai-${activePromptTab.key}-prompt`} key={activePromptTab.key}>
                    <PromptEditor
                        id={`ai-${activePromptTab.key}-prompt-input`}
                        title={activePromptTab.title}
                        help={activePromptTab.help}
                        value={promptValues[activePromptTab.key]}
                        maxLength={activePromptTab.maxLength}
                        height={promptHeight}
                        optimizing={promptOptimizing === activePromptTab.key}
                        onChange={event => promptSetters[activePromptTab.key](event.target.value)}
                        onBlur={() => savePrompt(activePromptTab.key, promptValues[activePromptTab.key])}
                        onResize={height => setPromptHeight(Math.min(420, Math.max(160, height)))}
                        onOptimize={() => optimizePrompt(activePromptTab.key)}
                        onRestore={() => restorePrompt(activePromptTab.key)} />
                </div>

                {promptPreview && <div className={s.promptPreview} role='dialog' aria-label={t.s('aiPromptPreview')}>
                    <Label>{t.s('aiPromptPreview')}</Label>
                    <div className={s.promptPreviewGrid}>
                        <div>
                            <SubLabel>{t.s('aiPromptOriginal')}</SubLabel>
                            <Text autoSize multiline minRows={5} value={promptPreview.original} readOnly aria-label={t.s('aiPromptOriginal')} />
                        </div>
                        <div>
                            <SubLabel>{t.s('aiPromptOptimized')}</SubLabel>
                            <Text autoSize multiline minRows={5} value={promptPreview.prompt} readOnly aria-label={t.s('aiPromptOptimized')} />
                        </div>
                    </div>
                    {promptPreview.summary && <SubLabel>{promptPreview.summary}</SubLabel>}
                    <div className={s.promptActions}>
                        <Button as='button' type='button' variant='primary' onClick={applyPromptPreview}>{t.s('aiPromptApply')}</Button>
                        <Button as='button' type='button' variant='link' onClick={() => setPromptPreview(null)}>{t.s('cancel')}</Button>
                    </div>
                </div>}
            </section>
        </>
    )
}

export default connect(
    state => ({
        ai_suggestions: state.config.ai_suggestions,
        ai_assistant: state.config.ai_assistant,
        ai_collection_prompt: state.config.ai_collection_prompt,
        ai_note_prompt: state.config.ai_note_prompt,
        ai_note_thinking: state.config.ai_note_thinking,
        ai_tag_prompt: state.config.ai_tag_prompt,
        ai_workers_model: state.config.ai_workers_model,
        ai_thinking_enabled: state.config.ai_thinking_enabled,
        ai_thinking_level: state.config.ai_thinking_level,
        isPro: isPro(state)
    }),
    { set }
)(SettingsAppAi)

import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { API_ORIGIN } from '~data/constants/app'

const publicCollectionPath = resource => {
    if (process.env.RUNTIME_DOMAIN_MODE !== 'true')
        return '/public/' + encodeURIComponent(resource || '')

    const match = String(resource || '').match(/^(.*)-(\d+)$/)
    return match ? '/v1/public/collections/' + match[2] + '/' + encodeURIComponent(match[1]) : '/v1/public/collections/0'
}

export default function PublicCollection() {
    const { resource } = useParams()
    const [state, setState] = useState({ loading: true, error: false, payload: null })

    useEffect(() => {
        let active = true
        fetch(API_ORIGIN + publicCollectionPath(resource), { credentials: 'omit' })
            .then(response => response.ok ? response.json() : Promise.reject(new Error('not_found')))
            .then(payload => active && setState({ loading: false, error: false, payload }))
            .catch(() => active && setState({ loading: false, error: true, payload: null }))
        return () => { active = false }
    }, [resource])

    if (state.loading) return <main><p>Loading…</p></main>
    if (state.error || !state.payload?.collection)
        return <main><h1>Collection not found</h1></main>

    const { collection, items = [] } = state.payload
    return (
        <main>
            <Helmet><title>{collection.title}</title></Helmet>
            <h1>{collection.title}</h1>
            <ul>
                {items.map(item => (
                    <li key={item._id}>
                        <a href={item.link} target='_blank' rel='noreferrer'>{item.title || item.link}</a>
                        {item.description ? <p>{item.description}</p> : null}
                        {item.publishedSnapshots?.map(snapshot => (
                            <a key={snapshot.contentId} href={snapshot.downloadUrl} target='_blank' rel='noreferrer'>
                                {snapshot.filename}
                            </a>
                        ))}
                    </li>
                ))}
            </ul>
        </main>
    )
}

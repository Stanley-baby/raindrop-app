import s from './view.module.styl'
import React from 'react'
import getThumbUri from '~data/modules/format/thumb'
import getScreenshotUri from '~data/modules/format/screenshot'
import getFaviconUri from '~data/modules/format/favicon'
import size from './size'
import Preloader from '~co/common/preloader'
import { RENDER_URL } from '~data/constants/app'

const coverRetryInterval = 12000
let coverRetryQueue = Promise.resolve()
let nextCoverRetryAt = 0
// ponytail: retries are serialized per tab; cross-tab/account coordination requires a shared queue.
const queueCoverRetry = () => {
    const retry = coverRetryQueue.then(() => new Promise(resolve => {
        const now = Date.now()
        const retryAt = Math.max(now + coverRetryInterval, nextCoverRetryAt)
        nextCoverRetryAt = retryAt + coverRetryInterval
        setTimeout(resolve, retryAt - now)
    }))
    coverRetryQueue = retry.catch(() => {})
    return retry
}

//cache thumb/screenshot uri
const thumbs = {}
const getUri = (uri, mode='', domain)=>{
    if (!thumbs[uri])
        switch (mode) {
            case 'screenshot':
                thumbs[uri] = getScreenshotUri(uri)
                break

            case 'favicon':
                thumbs[uri] = domain ? getFaviconUri(domain) : getThumbUri(uri)
                break
        
            default:
                thumbs[uri] = getThumbUri(uri)
                break
        }
    return thumbs[uri]
}

//pixel density
const dpr = {
    grid: (window.devicePixelRatio||1)+1,
    masonry: (window.devicePixelRatio||1)+1,
    default: window.devicePixelRatio||1
}

//main component
export default class BookmarkItemCover extends React.PureComponent {
    static defaultProps = {
        cover:  '',
        link:   '', //required
        view:   'list',
        indicator:false
    }

    state = {
        loaded: this.props.indicator ? false : true,
        retryVersion: 0
    }

    componentDidMount() {
        this.mounted = true
    }

    componentWillUnmount() {
        this.mounted = false
    }

    componentDidUpdate(previousProps) {
        if (this.retryQueued && (previousProps.cover !== this.props.cover || previousProps.link !== this.props.link)) {
            this.retryQueued = false
            this.setState({ retryVersion: 0 })
        }
    }

    onImageLoadStart = ()=>
        this.setState({ loaded: false })

    onImageLoadSuccess = ()=>
        this.setState({ loaded: true })

    onImageError = event => {
        const source = event.currentTarget.currentSrc || event.currentTarget.src || ''
        const { indicator } = this.props
        if (!this.retryQueued && RENDER_URL && source.startsWith(`${RENDER_URL}/`)) {
            this.retryQueued = true
            if (indicator) this.setState({ loaded: false })
            queueCoverRetry().then(() => {
                if (this.mounted)
                    this.setState(state => ({ retryVersion: state.retryVersion + 1 }))
            })
        } else if (indicator) this.onImageLoadSuccess()
    }

    renderImage = ()=>{
        const { cover, view, link, domain, coverSize, indicator, ...etc } = this.props
        const retry = this.state.retryVersion ? `&rd-cover-retry=${this.state.retryVersion}` : ''
        let { width, height, ar } = size(view, coverSize) //use height only for img element
        let uri

        switch(view){
            //simple always have a favicon
            case 'simple':
                if (link)
                    uri = getUri(link, 'favicon', domain)
                break

            //in other view modes we show a thumbnail or screenshot
            default:
                if (cover && cover!='<screenshot>')
                    uri = getUri(cover)
                else if (link)
                    uri = getUri(link, 'screenshot')
                break
        }

        let mode
        switch(view) {
            case 'grid':
                mode = 'fillmax'
                break

            default:
                mode = 'crop'
                break
        }

        return (
            <>
                <source
                    srcSet={uri && `${uri}?mode=${mode}&fill=solid&format=webp&width=${width||''}&ar=${ar||''}&dpr=${dpr[view]||dpr.default}${retry}`}
                    type='image/webp' />

                <img 
                    tabIndex='-1'
                    className={s.image}
                    data-ar={ar}
                    width={width}
                    height={height}
                    alt=' '
                    {...etc}
                    src={uri && `${uri}?mode=${mode}&fill=solid&width=${width||''}&ar=${ar||''}&dpr=${dpr[view]||dpr.default}${retry}`}
                    //type='image/jpeg'
                    onLoadStart={indicator ? this.onImageLoadStart : undefined}
                    onLoad={indicator ? this.onImageLoadSuccess : undefined}
                    onError={uri ? this.onImageError : undefined} />
            </>
        )
    }

    render() {
        const { className='', view, indicator } = this.props
        const { loaded } = this.state

        return (
            <picture 
                role='img'
                className={s.wrap+' '+s[view]+' '+className}>
                {this.renderImage()}
                {!loaded && indicator && <div className={s.preloader}><Preloader /></div>}
            </picture>
        )
    }
}

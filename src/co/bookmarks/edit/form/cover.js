import styles from './cover.module.styl'
import React from 'react'
import t from '~t'
import { captureTab, target } from '~target'
import { independentService } from '~config/environment'
import captureScreenshot from '~data/modules/captureScreenshot'

import Cover from '~co/bookmarks/item/cover'
import Icon from '~co/common/icon'
import ImagePicker from '~co/picker/image'

export default class BookmarkEditFormCover extends React.Component {
    state = {
        modal: false
    }

    onModalOpen = (e)=>{
        e.preventDefault()
        this.setState({ modal: true })
    }

    handlers = {
        onClose: ()=>
            this.setState({ modal: false }),

        onLink: async(link)=>{
            let media = [...this.props.item.media || []]

            if (!media.some(item=>item.link == link))
                media = [ ...media, { link, ...(link === '<screenshot>' ? { screenshot: true } : {}) } ]

            this.props.onChange({
                cover: link,
                media
            })

            await this.props.onSave()
        },

        onScreenshot: async()=>{
            if (independentService && target === 'web') {
                let bookmarkId = this.props.item._id
                if (!bookmarkId) {
                    const saved = await this.props.onSave()
                    const item = Array.isArray(saved) ? saved[0] : saved
                    bookmarkId = item?._id
                }
                if (!bookmarkId)
                    throw new Error('Bookmark must be saved before taking a screenshot')

                const item = await captureScreenshot(bookmarkId)
                this.props.onChange({ cover: item.cover, media: item.media })
                return this.props.onSave()
            }

            const screenshot = await captureTab(this.props.item.link)

            if (typeof screenshot == 'string')
                await this.handlers.onLink('<screenshot>')
            else
                await this.handlers.onFile(screenshot)
        },

        onFile: async(file)=>{
            return this.props.onUploadCover(file)
        }
    }

    render() {
        const { item: { cover, link, media } } = this.props
        const pickerItems = [...media || []]
        if (typeof cover === 'string' && cover.includes('/v1/content/') && !pickerItems.some(item => item.link === cover))
            pickerItems.push({ link: cover, screenshot: true })

        return (
            <div className={styles.wrap}>
                <a 
                    href=''
                    className={styles.cover}
                    title={t.s('changeIcon')}
                    onClick={this.onModalOpen}>
                    <Cover 
                        cover={cover}
                        link={link}
                        view='list' />

                    <span className={styles.more}>
                        <Icon name='arrow' />
                    </span>
                </a>

                {this.state.modal && (
                    <ImagePicker
                        items={pickerItems}
                        selected={cover}
                        {...this.handlers} />
                )}
            </div>
        )
    }
}

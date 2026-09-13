import { createSelector } from 'reselect'
import {
	getBookmarkScreenshotIndex,
	blankSpace,
	blankBookmark,
	blankMeta
} from '../../helpers/bookmarks'

const emptyObject = {}

//Single
export const bookmark = ({bookmarks}, _id)=>bookmarks.elements[_id] ? bookmarks.elements[_id] : blankBookmark

export const makeBookmark = ()=>bookmark

export const makeHaveScreenshot = ()=>createSelector(
	[({bookmarks})=>bookmarks, (state, _id)=>_id],
	(bookmarks, _id)=>getBookmarkScreenshotIndex(bookmarks,_id)!=-1
)

export const highlight = ({bookmarks : { spaces } }, spaceId, _id)=>
	(
		(spaces[spaceId] ? spaces[spaceId] : blankSpace)
			.highlight
	)[_id] || emptyObject

export const makeHighlight = ()=>highlight

export const tags = ({bookmarks}, _id)=>(bookmarks.meta[_id] ? bookmarks.meta[_id] : blankMeta).tags

export const highlights = ({bookmarks}, _id, limit=0)=>{
	const items = (bookmarks.meta[_id] ? bookmarks.meta[_id] : blankMeta).highlights
	if (limit)
		return items.slice(0, limit)
	return items
}

export const makeHighlights = ()=>highlights

export const makeCreatorRef = ()=>createSelector(
	[({bookmarks}, _id)=>bookmarks.meta[_id], ({user})=>user.current._id],
	(meta, currentUserId)=>{
		const { creatorRef } = meta || blankMeta

		if (creatorRef && creatorRef._id == currentUserId)
			return blankMeta.creatorRef
			
		return creatorRef
	}
)

export const makeSuggestedFields = ()=>createSelector(
	[
		({bookmarks}, { link })=>bookmarks.suggestedFields[link] || emptyObject
	],
	({ collections=[], tags=[], new_tags=[], new_collections=[], collection_recommendations=[], suggestion_status='', suggestion_source='', collection_status='', tags_status='', collection_source='', tags_source='' })=>{
		return ({
			collections: [...collections].splice(0, 5),
			tags: [...tags],
			new_tags: [...new_tags],
			new_collections: [...new_collections].splice(0, 3),
			collection_recommendations: [...collection_recommendations].splice(0, 8),
			suggestion_status,
			suggestion_source,
			collection_status: collection_status || suggestion_status,
			tags_status: tags_status || suggestion_status,
			collection_source: collection_source || suggestion_source,
			tags_source: tags_source || suggestion_source
		})
	}
)

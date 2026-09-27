import { call, put, takeEvery, select, delay } from 'redux-saga/effects'
import Api from '../../modules/api'
import _ from 'lodash-es'

import {
	BOOKMARK_LOAD_REQ, BOOKMARK_LOAD_SUCCESS, BOOKMARK_LOAD_ERROR,
	BOOKMARK_CREATE_REQ, BOOKMARK_CREATE_SUCCESS, BOOKMARK_CREATE_ERROR,
	BOOKMARKS_CREATE_REQ,
	BOOKMARK_UPDATE_REQ, BOOKMARK_UPDATE_SUCCESS, BOOKMARK_UPDATE_ERROR,
	BOOKMARK_REMOVE_REQ, BOOKMARK_REMOVE_SUCCESS, BOOKMARK_REMOVE_ERROR,
	BOOKMARK_UPLOAD_REQ,
	BOOKMARK_REORDER,
	BOOKMARK_SUGGEST_FIELDS, BOOKMARK_SUGGESTED_FIELDS,

	BOOKMARK_RECOVER, BOOKMARK_IMPORTANT, BOOKMARK_SCREENSHOT, BOOKMARK_REPARSE, BOOKMARK_RECHECK, BOOKMARK_MOVE,
	BOOKMARKS_REPARSE_INPLACE
} from '../../constants/bookmarks'

import {
	getBookmark,
	getBookmarkScreenshotIndex,
	getMeta
} from '../../helpers/bookmarks'

import { isPro } from '../../selectors/user'
import { independentService } from '~config/environment'
import captureScreenshot from '../../modules/captureScreenshot'

//Requests
export default function* () {
	//helpers
	yield takeEvery(BOOKMARK_RECOVER, recover)
	yield takeEvery(BOOKMARK_IMPORTANT, important)
	yield takeEvery(BOOKMARK_SCREENSHOT, screenshot)
	yield takeEvery(BOOKMARK_REPARSE, reparse)
	yield takeEvery(BOOKMARK_RECHECK, recheck)
	yield takeEvery(BOOKMARK_MOVE, move)
	yield takeEvery(BOOKMARK_REORDER, reorder)

	//single
	yield takeEvery(BOOKMARK_LOAD_REQ, loadBookmark)
	yield takeEvery(BOOKMARK_CREATE_REQ, createBookmark)
	yield takeEvery(BOOKMARK_UPDATE_REQ, updateBookmark)
	yield takeEvery(BOOKMARK_REMOVE_REQ, removeBookmark)
	yield takeEvery(BOOKMARK_UPLOAD_REQ, uploadBookmark)
	yield takeEvery(BOOKMARK_SUGGEST_FIELDS, suggestFields)

	//many
	yield takeEvery(BOOKMARKS_CREATE_REQ, createBookmarks)
	yield takeEvery(BOOKMARKS_REPARSE_INPLACE, reparseInplace)
}

function* pollLinkCheck(taskId, _id) {
	for (let attempt = 0; attempt < 30; attempt++) {
		yield delay(1000)
		const result = yield call(Api.get, `tasks/${encodeURIComponent(taskId)}`)
		const task = result.task || {}
		if (task.status === 'succeeded') {
			yield put({ type: BOOKMARK_LOAD_REQ, _id })
			return
		}
		if (['dead_letter', 'failed'].includes(task.status))
			throw new Error(task.failure?.message || 'Link check failed')
	}
	throw new Error('Link check timed out')
}

function* recheck({ _id, ignore=false, onSuccess, onFail }) {
	if (ignore || !_id) return
	try {
		const result = yield call(Api.post, `raindrop/${_id}/link-check`, {})
		if (!result.taskId) throw new Error('Link check was not queued')
		const metadata = yield call(pollLinkCheck, result.taskId, _id)
		if (typeof onSuccess === 'function') onSuccess(metadata)
	} catch (error) {
		if (typeof onFail === 'function') onFail(error)
	}
}

function* loadBookmark({ ignore=false, _id, onSuccess, onFail }) {
	if (ignore)
		return;

	try{
		const { item } = yield call(Api.get, `raindrop/${_id}`)

		yield put({
			type: BOOKMARK_LOAD_SUCCESS,
			_id,
			item,
			onSuccess, onFail
		})
	} catch (error) {
		yield put({
			type: BOOKMARK_LOAD_ERROR,
			_id,
			error,
			onSuccess, onFail
		})
	}
}

function* createBookmark({obj={}, ignore=false, draft, onSuccess, onFail}) {
	if (ignore) return;

	try{
		let item = { ...obj }

		//minimum info is already provided, grab all other in background on server
		if (item.title || independentService)
			item.pleaseParse = { weight: 1 }
		//parse bookmark otherwise
		else {
			const parsed = yield call(Api.get, 'import/url/parse?url='+encodeURIComponent(item.link))

			item = { ...item, ...parsed.item }
		}

		//try to create bookmark on server
		let res
		try {
			res = yield call(Api.post, 'raindrop', item)
		} catch (e) {}

		//try again, maybe it's collectionId related issue
		if (!res)
			res = yield call(Api.post, 'raindrop', {...item, collectionId: -1 })

		yield put({
			type: BOOKMARK_CREATE_SUCCESS,
			_id: res.item._id,
			item: res.item,
			draft,
			onSuccess, onFail
		});
	} catch (error) {
		yield put({
			type: BOOKMARK_CREATE_ERROR,
			obj,
			draft,
			error,
			onSuccess, onFail
		});
	}
}

function* createBookmarks({items=[], ignore=false, onSuccess, onFail}) {
	if (ignore) return;

	try{
		let created = []

		const chunks = _.chunk(items, 999)
		for(const chunk of chunks){
			const res = yield call(Api.post, 'raindrops', {
				items: chunk.map(item=>({
					...item,
					pleaseParse: {
						weight: items.length
					}
				}))
			}, { timeout: 0 })
			
			created.push(...res.items)
		}

		yield put({
			type: BOOKMARK_CREATE_SUCCESS,
			_id: created.map(({_id})=>_id),
			item: created,
			onSuccess, onFail
		})
	} catch (error) {
		yield put({
			type: BOOKMARK_CREATE_ERROR,
			error,
			onSuccess, onFail
		});
	}
}

function* uploadBookmark({obj={}, ignore=false, onSuccess, onFail}) {
	if (ignore)
		return;

	try{
		//Todo: Check collectionId before creating bookmark!

		const { item={} } = yield call(Api.upload, 'raindrop/file', obj, { timeout: 0 })

		yield put({
			type: BOOKMARK_CREATE_SUCCESS,
			_id: item._id,
			item: item,
			onSuccess, onFail
		});
	} catch (error) {
		yield put({
			type: BOOKMARK_CREATE_ERROR,
			obj,
			error,
			onSuccess, onFail
		});
	}
}

function* updateBookmark({_id, set={}, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		const { item={} } = yield call(Api.put, 'raindrop/'+_id, set)

		yield put({
			type: BOOKMARK_UPDATE_SUCCESS,
			item,
			onSuccess, onFail
		});
	} catch (error) {
		yield put({
			type: BOOKMARK_UPDATE_ERROR,
			_id,
			error,
			onSuccess, onFail
		});
	}
}

function* removeBookmark({_id, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		yield call(Api.del, 'raindrop/'+_id)

		yield put({
			type: BOOKMARK_REMOVE_SUCCESS,
			_id,
			onSuccess, onFail
		});
	} catch (error) {
		yield put({
			type: BOOKMARK_REMOVE_ERROR,
			_id,
			error,
			onSuccess, onFail
		});
	}
}

function* recover({_id, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		const state = yield select()
		const item = getBookmark(state.bookmarks, _id)

		yield put({
			type: BOOKMARK_UPDATE_REQ,
			_id: item._id,
			set: {
				collectionId: -1,
				removed: false
			},
			onSuccess
		})
	}catch(error){
		yield put({
			type: BOOKMARK_UPDATE_ERROR,
			_id: _id,
			error,
			onFail
		})
	}
}

function* important({_id, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		const state = yield select()
		const item = getBookmark(state.bookmarks, _id)

		yield put({
			type: BOOKMARK_UPDATE_REQ,
			_id: item._id,
			set: {
				important: item.important
			},
			onSuccess
		})
	}catch(error){
		yield put({
			type: BOOKMARK_UPDATE_ERROR,
			_id: _id,
			error,
			onFail
		})
	}
}

function* screenshot({_id, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		const state = yield select()
		const item = getBookmark(state.bookmarks, _id)
		const meta = getMeta(state.bookmarks, _id)
		const screenshotIndex = getBookmarkScreenshotIndex(state.bookmarks, _id)

		if (independentService && screenshotIndex !== -1) {
			yield put({
				type: BOOKMARK_UPDATE_SUCCESS,
				item: {
					...item,
					cover: meta.media[screenshotIndex].link
				},
				onSuccess, onFail
			})
			return
		}

		if (independentService) {
			const captured = yield call(captureScreenshot, item._id)
			yield put({
				type: BOOKMARK_UPDATE_SUCCESS,
				item: captured,
				onSuccess, onFail
			})
			return
		}

		var setReq = {}
		if (screenshotIndex!=-1){
			setReq = {
				cover: '<screenshot>'
			}
		}else{
			const newMedia = meta.media.concat([{link: '<screenshot>', screenshot: true}])
			setReq = {
				media: newMedia,
				cover: '<screenshot>'
			}
		}

		yield put({
			type: BOOKMARK_UPDATE_REQ,
			_id: item._id,
			set: setReq,
			onSuccess
		})
	}catch(error){
		yield put({
			type: BOOKMARK_UPDATE_ERROR,
			_id: _id,
			error,
			onFail
		})
	}
}

function* reparse({_id, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		const state = yield select()
		const item = getBookmark(state.bookmarks, _id)

		yield put({
			type: BOOKMARK_UPDATE_REQ,
			_id: item._id,
			set: {
				title: item.link,
				excerpt: '',
				cover: '',
				media: [],
				pleaseParse: {
					date: new Date()
				}
			},
			onSuccess
		})
	}catch(error){
		yield put({
			type: BOOKMARK_UPDATE_ERROR,
			_id: _id,
			error,
			onFail
		})
	}
}

function* move({_id, collectionId, ignore=false, onSuccess, onFail}) {
	if ((ignore)||(!_id))
		return;

	try{
		yield put({
			type: BOOKMARK_UPDATE_REQ,
			_id: _id,
			set: {
				collectionId: collectionId
			},
			onSuccess
		})
	}catch(error){
		yield put({
			type: BOOKMARK_UPDATE_ERROR,
			_id: _id,
			error,
			onFail
		})
	}
}

function* reorder({ _id, ignore, order, collectionId }) {
	if (ignore || typeof order == 'undefined') return

	yield put({
		type: BOOKMARK_UPDATE_REQ,
		_id: _id,
		set: {
			order,
			collectionId
		}
	})
}

function* suggestFields({ obj, ignore, onSuccess, onFail, field='all', requestId }) {
	if (ignore) return
	if (!obj?.link && !obj?._id) return

	try{
		const state = yield select()
		if (!state.config?.ai_suggestions) return
		const pro = isPro(state)
		if (!pro && !independentService) return

		const requestOptions = { retries: 0, timeout: 0 }
		const { item={} } = obj._id ?
			yield call(Api.get, `raindrop/${obj._id}/suggest`, requestOptions) :
			yield call(Api.post, 'raindrop/suggest', obj, requestOptions)
		const collections = item.collections || []
		const tags = item.tags || []
		const newTags = item.new_tags || []
		const newCollections = item.new_collections || item.newCollections || []
		const createSuggestions = item.create_suggestions || item.createSuggestions || item.new_collection_details || item.newCollectionDetails || []
		const collectionRecommendations = item.collection_recommendations || item.collectionRecommendations || []
		const suggestionStatus = item.suggestion_status || item.suggestionStatus ||
			(collections.length || tags.length || newTags.length || newCollections.length || createSuggestions.length || collectionRecommendations.length ? 'suggestions' : 'no_match')
		const suggestionSource = item.suggestion_source || item.suggestionSource || ''
		const normalizedTitle = item.normalized_title || item.normalizedTitle || ''
		const suggestedNote = item.note || item.suggested_note || item.suggestedNote || ''
		const collectionStatus = collections.length || newCollections.length || createSuggestions.length || collectionRecommendations.length
			? suggestionSource == 'fallback' ? 'fallback' : 'suggestions'
			: 'no_match'
		const tagsStatus = tags.length || newTags.length
			? suggestionSource == 'fallback' ? 'fallback' : 'suggestions'
			: 'no_match'

		yield put({
			type: BOOKMARK_SUGGESTED_FIELDS,
			link: obj.link,
			field,
			requestId,
			collections: collections.map(collection => collection?.$id ?? collection?.id ?? collection?._id ?? collection),
			tags,
			new_tags: newTags,
			new_collections: newCollections,
			create_suggestions: createSuggestions,
			collection_recommendations: collectionRecommendations,
			suggestion_status: suggestionStatus,
			suggestion_source: suggestionSource,
			collection_status: collectionStatus,
			tags_status: tagsStatus
		})
		let latestRequestId
		if (requestId)
			latestRequestId = yield select(state=>{
				const value = state.bookmarks.suggestedFields[obj.link]
				return field == 'collection' ? value?.collectionRequestId : field == 'tags' ? value?.tagsRequestId : value?.requestId
			})
		if (!requestId || !latestRequestId || requestId == latestRequestId)
			if (typeof onSuccess == 'function') onSuccess({ status: suggestionStatus, source: suggestionSource, normalizedTitle, note: suggestedNote })
	} catch (error) {
		if (error?.message)
			error.message = error.message.replace(/\s+https?:\/\/\S+\/v1\/raindrop(?:\/\d+)?\/suggest$/, '')
		let latestRequestId
		if (requestId)
			latestRequestId = yield select(state=>{
				const value = state.bookmarks.suggestedFields[obj.link]
				return field == 'collection' ? value?.collectionRequestId : field == 'tags' ? value?.tagsRequestId : value?.requestId
			})
		if ((!requestId || !latestRequestId || requestId == latestRequestId) && typeof onFail == 'function') onFail(error)
		console.error(error)
	}
}

function* reparseInplace({ items, ignore }) {
	if (ignore) return

	try{
		for(const { _id, link } of items) {
			const parsed = yield call(Api.get, 'import/url/parse?url='+encodeURIComponent(link))

			yield put({
				type: BOOKMARK_UPDATE_REQ,
				_id: _id,
				set: {
					...parsed.item,
					pleaseParse: null
				}
			})
		}
	} catch (error) {
		console.error(error)
	}
}

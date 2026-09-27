export const DEFAULT_AI_NOTE_PROMPT = 'Write a concise, high-value note for a future reader of this bookmark using the pattern: what the resource is, then its core purpose. Use the supplied title, description, tags, highlights, and URL. Describe the resource, not the currently signed-in user or session. Never include usernames, email addresses, account names, IDs, login state, or other personal or temporary page data. Do not invent facts, details, people, or claims. Use the requested language. Return only the final note, with no heading or reasoning.'

export const DEFAULT_AI_COLLECTION_PROMPT = [
    'Check the supplied existing Collection list first and prefer one best match, with at most two ranked alternatives (three existing Collections total).',
    'Choose only a broad, stable, long-term category that can hold related Bookmarks; do not use a product name, article type, single topic, or tag-like term as an existing Collection.',
    'If an existing top-level Collection is a reasonable fit but no supplied child Collection is a better fit, return that parent in collections and may return one to three concise new child Collections in new_collections with its parentId.',
    'Prefer an existing child Collection when available; otherwise use the matching top-level Collection as parent context for a new child.',
    'If no supplied Collection is a reasonable fit, suggest one to three concise new child Collections in new_collections only when the topic is broad and durable, with one supplied top-level category and parentId when available.',
    'Never invent an existing Collection ID, top-level category, timestamp, random ID, full sentence, or duplicate/near-duplicate Collection title.'
].join('\n')

export const DEFAULT_AI_TAG_PROMPT = [
    'Return at most six total suggestions, preferably three to six high-value terms and zero when there is no strong signal.',
    'Prefer concrete topics, entities, technologies, methods, and professional domains that improve future retrieval.',
    'Never mechanically split the page title into Tags. Exclude usernames, email addresses or their parts, account/home/login/welcome/dashboard state, numeric IDs, dates, and navigation labels.',
    'Do not return descriptions, full sentences, generic terms such as article/content/resource/website/research, or a term already present in the Bookmark tags.',
    'Do not use a host or URL fragment as a tag unless it improves future retrieval.',
    'Do not return obvious singular/plural, punctuation, translation, or containment duplicates of another suggested tag.',
    'A tag may overlap a Collection only when it adds independent search value. Each Tag may include confidence (0-1) and a short reason.'
].join('\n')

export const AI_COLLECTION_TOP_LEVELS = [
    '技术与开发',
    '工作与项目',
    '学习与研究',
    '生活与实用',
    '旅行与地点',
    '内容与阅读',
    '媒体与娱乐',
    '待整理'
]

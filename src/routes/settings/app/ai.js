import React, { useEffect, useState } from 'react'
import t from '~t'
import { Link } from 'react-router-dom'
import { connect } from 'react-redux'
import { set } from '~data/actions/config'
import { DEFAULT_AI_NOTE_PROMPT } from '~data/constants/ai'
import { isPro } from '~data/selectors/user'
import config from '~config'

import { Label, Checkbox, SubLabel, Text } from '~co/common/form'

function SettingsAppAi ({ ai_suggestions, ai_assistant, ai_note_prompt, ai_note_thinking, isPro, set }){
	const [notePrompt, setNotePrompt] = useState(ai_note_prompt || DEFAULT_AI_NOTE_PROMPT)

	useEffect(()=>setNotePrompt(ai_note_prompt || DEFAULT_AI_NOTE_PROMPT), [ai_note_prompt])

	return (
		<>
			<Label>AI</Label>
			<div>
				<Checkbox 
					checked={ai_assistant}
					onChange={()=>set('ai_assistant', !ai_assistant)}>
					{t.s('ask')} AI
					<a href={config.links.help.stella.index} target='_blank'>[?]</a>
				</Checkbox>

				<Checkbox 
					checked={ai_suggestions}
					onChange={()=>set('ai_suggestions', !ai_suggestions)}>
					{t.s('suggestedCollectionsAndTags')}
				</Checkbox>

				<SubLabel>
					{!isPro && <>Only available for <Link to='/settings/pro'>Pro</Link>. </>}
					{t.s('aiDescription')}
				</SubLabel>
			</div>

			<Label>{t.s('aiNotePrompt')}</Label>
			<div>
				<Text
					autoSize
					multiline
					minRows={6}
					maxLength={4000}
					value={notePrompt}
					onChange={event=>setNotePrompt(event.target.value)}
					onBlur={()=>set('ai_note_prompt', notePrompt.trim() || DEFAULT_AI_NOTE_PROMPT)} />

				<SubLabel>{t.s('aiNotePromptHelp')}</SubLabel>

				<Checkbox
					checked={ai_note_thinking}
					onChange={()=>set('ai_note_thinking', !ai_note_thinking)}>
					{t.s('aiNoteThinking')}
				</Checkbox>

				<SubLabel>{t.s('aiNoteThinkingHelp')}</SubLabel>
			</div>
		</>
	)
}

export default connect(
	(state)=>({
		ai_suggestions: state.config.ai_suggestions,
		ai_assistant: state.config.ai_assistant,
		ai_note_prompt: state.config.ai_note_prompt,
		ai_note_thinking: state.config.ai_note_thinking,
		isPro: isPro(state)
	}),
	{ set }
)(SettingsAppAi)

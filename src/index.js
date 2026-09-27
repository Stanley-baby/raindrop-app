//react
import './wdyr'
import React from 'react'
import { render } from 'react-dom'
import { target, environment, initializeRuntimeDomain, openRuntimeDomainSettings } from '~target'
import Sentry from '~modules/vendors/sentry'

//polyfills
import 'form-request-submit-polyfill'
import 'intersection-observer'

//redux
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/es/integration/react'
import { withLocalReducer } from '~data'
import localReducers from './local/reducers'

import ServiceWorker from '~modules/sw/component'
import Translate from '~modules/translate/component'
import Routes from '~routes'
import Document from './routes/_document'
import App from './routes/_app'
import Splash from './routes/_splash'

//init redux
const { store, persistor } = withLocalReducer(localReducers)

//render app
const renderApp = () => render(
	//!add other global components in co/screen/basic
	<Sentry>
		<Document>
			<ServiceWorker>
				<Provider store={store}>
					<PersistGate loading={<Splash />} persistor={persistor}>
						<Translate loading={<Splash />}>
							<App>
								<Routes />
							</App>
						</Translate>
					</PersistGate>
				</Provider>
			</ServiceWorker>
		</Document>
	</Sentry>,
	
	document.getElementById('react')
)

initializeRuntimeDomain().then(ready => {
	if (ready) return renderApp()

	const root = document.getElementById('react')
	const message = document.createElement('p')
	message.textContent = 'Configure the self-hosted Web and API addresses before using the extension.'
	const link = document.createElement('a')
	link.href = '#'
	link.textContent = 'Open server settings'
	link.addEventListener('click', event => {
		event.preventDefault()
		openRuntimeDomainSettings()
	})
	root.replaceChildren(message, link)
	openRuntimeDomainSettings().catch(console.error)
}).catch(error => {
	console.error(error)
	document.getElementById('react').textContent = 'Unable to load server settings. Open the extension options and try again.'
})

//load lazy scripts (ignored in firefox extension, prohibited)
if (!(target == 'extension' && environment.includes('firefox')))
	window.onload = ()=>
		window.requestAnimationFrame(()=>{
			for(const script of document.querySelectorAll('.lazy-script')){
				script.async = true
				script.src = script.getAttribute('data-src')
			}
		})

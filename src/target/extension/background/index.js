import action from './action'
import commands from './commands'
import contextMenus from './contextMenus'
import links from './links'
import omnibox from './omnibox'
import runtime from './runtime'
import highlights from './highlights'
import fixSafariProfileCookies from './fix-safari-profile-cookies'
import { watchRuntimeDomainChanges } from '~target'

watchRuntimeDomainChanges()
action()
commands()
contextMenus()
omnibox()
links()
runtime()
highlights()
fixSafariProfileCookies()

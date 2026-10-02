import { app } from 'electron'
import { join } from 'path'

// Must run before app.whenReady(): separates userData (localStorage) per profile
// so a teacher and a student can be logged in on the same PC simultaneously.
const profileArg = process.argv.find((arg) => arg.startsWith('--profile='))
const profile = profileArg?.slice('--profile='.length).trim()

if (profile) {
  app.setPath('userData', join(app.getPath('appData'), `askkup-${profile}`))
}

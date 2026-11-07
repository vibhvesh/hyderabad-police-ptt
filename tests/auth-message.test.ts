import { describe, expect, it } from 'vitest'
import { explainAuthFailure, explainTokenSave } from '../src/lib/auth-message.ts'

describe('reference token messages', () => {
  it('does not treat a missing token as accepted', () => {
    expect(explainAuthFailure(401, false, 'The token was missing or not accepted.')).toMatch(/No administrator or commander token was sent/)
    expect(explainTokenSave(true, false)).toMatch(/not signed in/)
  })

  it('says a rejected token was not accepted', () => {
    expect(explainAuthFailure(401, true, 'The token was missing or not accepted.')).toMatch(/rejected this token/)
    expect(explainAuthFailure(401, true, 'The token was missing or not accepted.')).toMatch(/does not sign you in/)
  })

  it('separates a server that cannot be reached', () => {
    expect(explainAuthFailure(0, true, '')).toMatch(/could not be reached/)
  })
})

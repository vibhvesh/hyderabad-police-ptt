/** Plain-language result for the Reference page. Does not include secret values. */
export function explainAuthFailure(status: number, sentToken: boolean, serverMessage: string): string {
  if (status === 0) {
    return 'The reference server could not be reached. Saving tokens in this tab does not sign you in.'
  }
  if (!sentToken) {
    return 'No administrator or commander token was sent. These are not passwords you choose here. Copy ADMIN_TOKEN to file drafts, or REVIEWER_TOKEN to approve them. INGEST_TOKEN is only for questions and transcription upload. On Render, open this service, click Environment in the left pane, and read those keys. Saving an empty form does not sign you in.'
  }
  if (status === 401) {
    return 'The server rejected this token. Saving it does not sign you in. Copy the existing ADMIN_TOKEN (to file a draft) or REVIEWER_TOKEN (to approve one) from this service’s Environment page on Render. Do not invent a new value.'
  }
  if (status === 503) {
    return serverMessage || 'This action is not configured on the server.'
  }
  return serverMessage || 'The reference could not be loaded.'
}

export function explainTokenSave(saved: boolean, anyValue: boolean): string {
  if (!anyValue) return 'Nothing was saved. The token fields are empty, so you are not signed in.'
  if (!saved) return 'This browser blocked storing the tokens for this tab. They were not checked with the server.'
  return 'Stored in this tab only. The server has not accepted them yet. Use Reload to check.'
}

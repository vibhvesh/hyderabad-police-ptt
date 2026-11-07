export type PrefixEncoding = {
  input_ids: number[]
  attention_mask: number[]
  token_type_ids?: number[]
}

export type PrefixTokenizer = {
  convert_tokens_to_ids: (token: string) => number | null | undefined
  _encode_plus: (text: string, options?: object) => PrefixEncoding
}

const MARK = '__sanketPrefix'

/**
 * Transformers.js tokenizes `>>tel<<` as several pieces, so the multilingual OPUS model never sees the language token.
 * Keep that token as one id and encode the rest of the sentence normally.
 */
export function applyLanguagePrefix(tokenizer: PrefixTokenizer): void {
  const marked = tokenizer as PrefixTokenizer & { [MARK]?: boolean }
  if (marked[MARK]) return
  const original = tokenizer._encode_plus.bind(tokenizer)
  tokenizer._encode_plus = (text: string, options?: object) => {
    const match = /^>>\w+<<\s*/.exec(text)
    if (!match) return original(text, options)
    const token = match[0].trim()
    const id = tokenizer.convert_tokens_to_ids(token)
    if (typeof id !== 'number') {
      throw new Error(`The translation model has no single token for ${token}.`)
    }
    const encoded = original(text.slice(match[0].length), options)
    encoded.input_ids = [id, ...encoded.input_ids]
    encoded.attention_mask = [1, ...encoded.attention_mask]
    if (encoded.token_type_ids) encoded.token_type_ids = [0, ...encoded.token_type_ids]
    return encoded
  }
  marked[MARK] = true
}

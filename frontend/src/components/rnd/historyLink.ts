import { rndApi } from '@/lib/api'
import { INVALID_LINK, resolveRecordRef } from '@/lib/recordRef'

/** Load the saved calculation a calculator page's `?load=<ref>` link points at
 *  (links are built in rnd/history with recordHref(..., 'id', undefined, 'load')).
 *  An edited/incomplete ref is rejected with the standard "invalid link" message,
 *  shaped like an API error so the calculators' existing catch shows it as is. */
export async function getHistoryFromLink(ref: string) {
  let id: number
  try {
    id = await resolveRecordRef(ref)
  } catch (err: any) {
    if (err?.response || err?.message === INVALID_LINK) throw { response: { data: { detail: INVALID_LINK } } }
    throw err
  }
  return rndApi.getHistoryDetail(id)
}

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xdchyruasjxvrjduchoc.supabase.co'
const SUPABASE_KEY = 'sb_publishable_6gFWXVtCVf7mdtKw6ltYtw_AMI4fGOr'
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
// v4.11.0: Edge-Function-Adresse an einer Stelle, statt sie in jeder Komponente
// neu zusammenzusetzen (SettingsTab hatte sie bisher fest eingetippt).
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`
export const supabaseStorage = supabase

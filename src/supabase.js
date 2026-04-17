import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xdchyruasjxvrjduchoc.supabase.co'
const SUPABASE_KEY = 'sb_publishable_6gFWXVtCVf7mdtKw6ltYtw_AMI4fGOr'
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
export const supabaseStorage = supabase

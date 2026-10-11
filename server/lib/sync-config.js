// Where Sincronizar keeps its encrypted copies: Rumoria's Supabase project.
// The publishable key is public by design (it goes inside every copy of the
// app); it can only call the two functions in supabase/rumoria-sync.sql.
// RUMORIA_SYNC_URL / RUMORIA_SYNC_KEY replace them (tests, your own project).
module.exports = {
  url: process.env.RUMORIA_SYNC_URL || '',
  key: process.env.RUMORIA_SYNC_KEY || 'sb_publishable_V9eHsZnUSFt_BpqNBX1QMQ_i5TsltzG',
};

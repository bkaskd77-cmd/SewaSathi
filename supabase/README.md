# Database

Schema lives in `migrations/`, version-controlled and applied in filename
order. Nothing is clicked into the dashboard — if it is not in a migration
file, it does not exist as far as this repo is concerned.

Apply them with either:

```bash
npx supabase db push          # needs `npx supabase link` first
```

or by pasting a file into the Supabase dashboard SQL editor (fine for the
first one; use the CLI once there are several).

Regenerate the TypeScript types after any schema change:

```bash
npx supabase gen types typescript --project-id sfjsoyzosprwpnrtynpp > types/supabase.ts
```

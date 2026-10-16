<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- CRM data lives in Lovable Cloud tables (accounts, leads, messages, appointments, ai_usage); the browser reads/writes through `src/lib/crm/store.tsx`. Why: one place for optimistic state + persistence.
- Bot qualification runs only in `qualifyLead` (`src/lib/crm/qualify.server.ts`, exposed via `qualifyMessage`), which applies tag/stage rules from `automation.ts` after the AI extracts data. Why: keeps AI key and pipeline automation server-side and consistent.
- Follow-up flows run server-side: DB triggers on leads/messages create enrollments and apply the anti-spam cancel; a cron-called route `/api/public/flows-tick` runs due steps via `flow-runner.server.ts` (claim lock per enrollment). The browser only polls to display progress. Why: must work 24/7 with no browser open.
- Library uploads go to the private `materials` bucket and are shared via long-lived signed URLs. Why: workspace blocks public buckets.
- WhatsApp Cloud API credentials live in `whatsapp_channels` (service-role only, no client grants); all sends go through `dispatchMessage` in `whatsapp.server.ts`, which falls back to simulation when no enabled channel exists. Incoming messages hit `/api/public/whatsapp/webhook` (Meta HMAC signature with the account's App Secret) and reuse `qualifyLead` from `qualify.server.ts`. Why: tokens never reach the browser, one send path for bot, flows and advisors.
- Flow JSON (import, export, AI drafts) always goes through `parseFlow` in `flow-io.ts`; AI drafts come from Claude via `generateFlowDraft` and open in the editor unsaved. Why: one validator for every untrusted flow source.
- Visual system: glass/lift/press utilities and hairline/shadow tokens live in `src/styles.css`; `.bg-card` surfaces get frosted glass globally; theme (light/dark/system) is a `dark` class on <html> set by an inline head script + `ThemeToggle`. Why: restyle once at the token level instead of per component.

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
- Bot qualification runs only in the `qualifyMessage` server function (`src/lib/crm/ai.functions.ts`), which applies tag/stage rules from `automation.ts` after the AI extracts data. Why: keeps AI key and pipeline automation server-side and consistent.
- Follow-up flows run server-side: DB triggers on leads/messages create enrollments and apply the anti-spam cancel; a cron-called route `/api/public/flows-tick` runs due steps via `flow-runner.server.ts` (claim lock per enrollment). The browser only polls to display progress. Why: must work 24/7 with no browser open.
- Library uploads go to the private `materials` bucket and are shared via long-lived signed URLs. Why: workspace blocks public buckets.

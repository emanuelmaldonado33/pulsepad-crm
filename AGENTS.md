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
- Follow-up flows (flows, flow_enrollments, materials) run client-side in the `CrmProvider` engine in `store.tsx`: triggers and anti-spam cancellation come from diffing lead snapshots, and due steps run on a 15s interval. Why: no server scheduler yet; pure rules live in `flows.ts` and are unit-tested.

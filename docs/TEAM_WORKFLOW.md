# Team workflow and ownership

## Ownership

| Member | Primary responsibility                                                                                                       | Branches                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Kavya  | Product lead; product doctrine; intelligence and prediction; UI/UX direction; integration; final architecture and release QA | `feature/intelligence-*`, `feature/*-ui-*`, `integration/*`, `qa/*`       |
| Fuzail | System architecture; API and persistence; provider ledger; trust and audit; workers and alerts; UI/UX implementation support | `feature/backend-*`, `feature/*-ui-*`, `feature/trace-*`, `integration/*` |

Kavya and Fuzail jointly own the complete product surface. Product, UI/UX, backend, data, trust,
audit, worker and architecture changes require one of them as author and the other as reviewer.

## Starting work

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/your-assigned-branch
npm install
```

## Before pushing

```bash
npm run check
git status
git add <only-your-files>
git commit -m "type(scope): concise change"
git push -u origin feature/your-assigned-branch
```

Open a PR into `main`, request review from the other owner, and do not merge until CI passes. Pull
`main` before beginning a new task. When a shared contract changes, update its tests and document
every affected UI, API and worker consumer in the PR.

## Commit prefixes

- `feat`: user-visible or domain capability
- `fix`: defect correction
- `test`: test-only change
- `docs`: documentation
- `chore`: tooling or repository maintenance
- `refactor`: behaviour-preserving restructure

# Team workflow and ownership

## Ownership

| Member   | Primary responsibility                                                                                                       | Branches                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Kavya    | Product lead; contracts; state machine; graph/exposure; evidence gate; prediction orchestration; integration and frontend QA | `feature/intelligence-core`, `integration/*`, `qa/*`                                 |
| Fuzail   | Provider ledger; resolver; trace workers; alerts; reliability                                                                | `feature/trace-ledger`, `feature/provider-sandbox`, `feature/alerts-workers`         |
| Vatsal   | Auth/roles; PrivacyPass; identity resolution; audit validators                                                               | `feature/trust-access`, `feature/identity-resolution`, `feature/blockchain-registry` |
| Ujjwal   | Frontend lead; design system; Payment Risk/Verify; Command Center                                                            | `feature/payment-risk-ui`, `feature/command-center`, `feature/frontend-shell`        |
| Sandhya  | Complaint/case service; Case Intelligence graph and timeline                                                                 | `feature/case-service`, `feature/case-intelligence`                                  |
| Vanshika | Exit/Evidence Gate/Geo/Time UI and responsive polish                                                                         | `feature/geo-prediction`                                                             |

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

Open a PR into `main`, request the module owner's review, and do not merge until CI passes. Pull `main` before beginning a new task. When a shared contract changes, update its tests and notify every dependent owner before they wire UI or backend code.

## Commit prefixes

- `feat`: user-visible or domain capability
- `fix`: defect correction
- `test`: test-only change
- `docs`: documentation
- `chore`: tooling or repository maintenance
- `refactor`: behaviour-preserving restructure

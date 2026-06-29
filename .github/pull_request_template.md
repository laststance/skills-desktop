## Summary

-

## Test Plan

- [ ] `pnpm validate`
- [ ] `pnpm test:e2e`

## Security Checklist

- [ ] This change does not widen renderer access to Node.js, Electron, or direct filesystem APIs.
- [ ] New IPC or filesystem behavior validates untrusted renderer input in the main process.
- [ ] Dependency, workflow, or release changes preserve least-privilege permissions and pinned third-party Actions.
- [ ] Security-sensitive behavior is documented or linked from `SECURITY.md` when relevant.

# ESLint auto concurrency benchmark

Measured on 2026-09-05, 17:32–17:34 JST. Adding `--concurrency=auto` reduced
root lint wall time by **14.5%** in this run. The website median increased by
**30.4%**, with overlapping ranges and substantial variation; no website
speedup was demonstrated.

## Conditions

- Source: `f52fbbceea789aa785c4204fba489845e8c33a4b`, whose tree matches merged
  base `80ba1e586ddcd83dc77ff121d5f381624e0c6368`. Only package script strings
  differed during measurement; linted source and both lockfiles were unchanged.
- Apple M4 Max, 16 logical CPUs, 64 GiB RAM; macOS 26.6.2, arm64.
- Node.js 24.20.0, pnpm 11.5.1, ESLint 10.10.0 in both projects.
- Dependencies installed with `pnpm install --frozen-lockfile` in each project.
- One warmup per variant, then five measured pairs. Pair order alternated:
  auto/baseline, baseline/auto, auto/baseline, baseline/auto, auto/baseline.
- Sequential runs in one worktree, root first, then website. No concurrent
  validation/build workload was launched. Normal desktop background activity
  was not controlled.
- ESLint result caching was disabled (no `--cache`); OS filesystem caches were
  retained. Each run started a fresh process; timing includes pnpm startup,
  dependency checks, configuration loading, linting, and process shutdown.
- Baseline commands: root `pnpm exec eslint . --max-warnings 0`; website
  `pnpm exec eslint .`. Candidate commands append `--concurrency=auto`.
- `lint:fix` receives the same flag but was excluded from timing to avoid
  modifying the source between runs.

## Results

All times are seconds. Speed ratio is baseline median / auto median.

| Project | Baseline median (min–max) | Auto median (min–max) | Wall-time change | Speed ratio |
| ------- | ------------------------- | --------------------- | ---------------- | ----------- |
| Root    | 7.126 (6.880–7.234)       | 6.090 (5.758–6.430)   | −14.5%           | 1.170×      |
| Website | 0.797 (0.775–1.355)       | 1.039 (0.764–1.485)   | +30.4%           | 0.767×      |

Raw wall times, rounded to milliseconds:

| Pair              | First variant | Root baseline | Root auto | Website baseline | Website auto |
| ----------------- | ------------- | ------------- | --------- | ---------------- | ------------ |
| Warmup (excluded) | baseline      | 8.028         | 6.068     | 1.158            | 1.058        |
| 1                 | auto          | 7.234         | 6.016     | 1.355            | 1.280        |
| 2                 | baseline      | 7.126         | 6.090     | 1.307            | 1.485        |
| 3                 | auto          | 6.880         | 5.758     | 0.797            | 1.039        |
| 4                 | baseline      | 7.203         | 6.430     | 0.775            | 0.784        |
| 5                 | auto          | 6.921         | 6.175     | 0.776            | 0.764        |

All 24 warmup/measured runs exited 0 with empty stderr and no lint findings.
Root stdout contained only pnpm's up-to-date/dependency-check timing messages;
website stdout was empty. No `ESLintPoorConcurrencyWarning` was emitted.

Separate untimed `--debug` runs confirmed that `auto` used eight worker threads
for root and single-thread mode for website. The website result therefore
does not demonstrate multithreading overhead; its short runs were variable.

`auto` is a heuristic, so these local results do not predict CI performance or
guarantee a speedup on other machines. See the
[ESLint CLI concurrency reference](https://eslint.org/docs/latest/use/command-line-interface#--concurrency).

## Reproduce

From the repository root, after installing both projects' frozen lockfiles:

```bash
python3 - <<'PY'
import pathlib, subprocess, time

repository_root = pathlib.Path.cwd()
projects = [('root', repository_root, ['.', '--max-warnings', '0']),
            ('website', repository_root / 'website', ['.'])]
for project_name, project_dir, arguments in projects:
    # Pair zero warms both variants; subsequent pairs alternate execution order.
    for pair in range(6):
        variants = ['baseline', 'auto'] if pair % 2 == 0 else ['auto', 'baseline']
        for variant in variants:
            command = ['pnpm', 'exec', 'eslint', *arguments]
            if variant == 'auto':
                command.append('--concurrency=auto')
            started = time.perf_counter()
            result = subprocess.run(command, cwd=project_dir,
                                    text=True, capture_output=True)
            elapsed = time.perf_counter() - started
            print(project_name, pair, variant, elapsed, result.returncode,
                  repr(result.stdout), repr(result.stderr), flush=True)
            result.check_returncode()
PY
```

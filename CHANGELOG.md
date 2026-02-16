# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Test suite (Bun) with exports, Timeline, RangeTimeline tests
- CI workflow (`.github/workflows/ci.yaml`)
- GitHub metadata: CODEOWNERS, FUNDING.yml, issue/PR templates, dependabot
- Documentation: CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
- `tsconfig.build.json` for separate build config
- Scripts: `lint`, `typecheck`
- `types` field in package.json
- `engines` field (bun >=1.3, node >=20)
- `@types/bun` in devDependencies

### Changed

- `DateError` exported as class (value export) instead of type only — enables `instanceof` and `new DateError()`
- Removed `no-bitwise` from eslint-disable in BaseTimeline, RangeTimeline, Timeline
- package.json: restructure (homepage, bugs, funding, files)
- README: CI badge, link to CONTRIBUTING, full API docs
- LICENSE: year 2026
- Removed `.npmignore` (using `files` in package.json)

## [1.1.0] - 2025-08-14

### Added

- `find(predicate)` — find first item matching predicate
- `getDay(date)` — Day `{ at, items }` for a date, or `null`
- `getDays(start, end?, options?)` — array of Day objects with `includeEmpty`, `limit`, `offset`, `uniqueOnly` (RangeTimeline)
- `getClosestDay(date, direction?)` — closest Day (`before` | `after` | `either`)
- `isEmpty()` — check if timeline is empty
- `getStartsOn(date)` — items whose range starts on date (RangeTimeline)
- `getEndsOn(date)` — items whose range ends on date (RangeTimeline)
- `ONE_DAY` constant exported from BaseTimeline
- Types: `Day`, `DayOptions`, `RangeDayOptions`, `ParsedDayArgs`, `ParsedRangeOptions`, `RangeOptions`

### Changed

- **BREAKING:** `getDays()` renamed to `getDates()` — returns `Midnight[]` (previous `getDays` behavior)
- Internal optimization: `_rangeKeys` via iterator instead of callback, removed `tempItemBuffer`
- `getDates()` without args returns iterator keys (via spread)
- Item validation in add/addMany: `Object.hasOwn` replaced with `=== undefined` (inheritance support)
- RangeTimeline refactor: `#deduplicateItems`, `_resolveTsRange`, `_parseDayArgs`, `_findCeilingNode`, `_collectExistingDates`, `_calculateDayLimits`

## [1.0.2] - 2025-08-05

### Added

- `startAt` and `endAt` in `"bounds"` event payload (`BoundsChangeEvent`)

## [1.0.1] - 2025-08-04

### Added

- Initial release: Timeline and RangeTimeline classes
- Core API: add, delete, get, has, subscribe, getDays (dates)
- Event system: item, date, bounds

[Unreleased]: https://github.com/nesvet/tmln/compare/1.1.0...HEAD
[1.1.0]: https://github.com/nesvet/tmln/compare/1.0.2...1.1.0
[1.0.2]: https://github.com/nesvet/tmln/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/nesvet/tmln/releases/tag/1.0.1

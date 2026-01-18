## Build & Run
- `pnpm dev` - Start development server (port 3000)
- `pnpm build` - Production build
- `pnpm start` - Start production server

## Validation
- `pnpm test` - Run all tests (vitest)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm lint` - Run ESLint
- `pnpm build` - Verify build succeeds

## Practices
- Ensure you commit all changes after validating
- Workflow package is `workflow` (Vercel's Workflow DevKit)
- NEVER add 'install' dependency
- Workflow directives (`"use workflow"` or `"use step"`) go inside the function body. DO NOT put them at the top of the file.
- Use `zod` over hand-rolled schema parsing/validation
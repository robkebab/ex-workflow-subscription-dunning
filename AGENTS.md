## Build & Run
- `npm run dev` - Start development server (port 3000)
- `npm run build` - Production build
- `npm run start` - Start production server

## Validation
- `npm test` - Run all tests (vitest)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint
- `npm run build` - Verify build succeeds

## Practices
- Ensure you commit all changes after validating
- Workflow package is `workflow` (Vercel's Workflow DevKit)
- NEVER add 'install' dependency
- Workflow directives (`"use workflow"` or `"use step"`) go inside the function body. DO NOT put them at the top of the file.
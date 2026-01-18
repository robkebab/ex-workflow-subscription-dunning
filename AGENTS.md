## Build & Run
- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm run start` - Start production server

## Validation
- `npm test` - Run all tests
- `npm run build` - Verify build succeeds

## Practices
- Ensure you commit all changes after validating
- Workflow package is `workflow` (Vercel's Workflow DevKit)
- NEVER add 'install' dependency
- Workflow directives (`"use workflow"` or `"use step"`) go inside the function body. DO NOT put them at the top of the file.
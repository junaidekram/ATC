# GitHub Actions Deployment Guide

This project is configured to automatically build, test, and deploy to GitHub Pages using GitHub Actions.

## Automatic Deployment

The CI/CD workflow (`.github/workflows/ci-cd.yml`) automatically:

1. **On every push and pull request:**
   - Installs dependencies
   - Runs ESLint to check code quality
   - Runs the test suite with Vitest
   - Builds the production bundle

2. **On push to `main` branch only:**
   - Deploys the built application to GitHub Pages

## Setting Up GitHub Pages

To enable GitHub Pages deployment:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Pages**
3. Under "Build and deployment":
   - **Source**: Select "GitHub Actions"
   
That's it! The workflow will handle the rest.

## Accessing Your Deployed Site

After the first successful deployment, your site will be available at:
```
https://junaidekram.github.io/ATC/
```

## Manual Deployment

You can manually trigger a deployment:

1. Go to the **Actions** tab in your repository
2. Select the "CI/CD" workflow
3. Click "Run workflow"
4. Select the `main` branch and click "Run workflow"

## Local Development

For local development, continue using:

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run preview    # Preview production build
npm run test       # Run tests in watch mode
npm run test:ci    # Run tests once (used in CI)
npm run lint       # Check code with ESLint
```

## Build Configuration

The Vite configuration automatically sets the correct base path:
- **Development**: Uses `/` as the base path
- **GitHub Actions**: Uses `/ATC/` as the base path for proper asset loading

This is configured in `vite.config.ts` using the `process.env.GITHUB_ACTIONS` environment variable.

## Troubleshooting

### Build Fails

If the build fails in GitHub Actions:
1. Check the Actions tab for error logs
2. Ensure all tests pass locally with `npm run test:ci`
3. Ensure the build succeeds locally with `npm run build`
4. Check that all TypeScript errors are resolved with `tsc --noEmit`

### Deployment Fails

If deployment fails:
1. Verify GitHub Pages is enabled in repository settings
2. Ensure the workflow has the correct permissions (this is configured in the workflow file)
3. Check the Actions tab for specific deployment errors

### 404 Errors on Deployed Site

If you get 404 errors for assets:
1. Verify the base path in `vite.config.ts` matches your repository name
2. Clear your browser cache
3. Check that the deployment completed successfully in the Actions tab

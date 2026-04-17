// SPA-mode SvelteKit: no SSR, full prerender for the shell.
// Every route inherits these unless overridden.
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'never';

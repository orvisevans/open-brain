// Thin GitHub REST API wrappers for the post-sign-in setup flow.
// Routes through the same-origin /__gh_api proxy (see vite.config.ts) so the
// browser never hits api.github.com directly — identical CORS reasoning to
// device-flow.ts.

const API_PREFIX = '/__gh_api';

export interface GitHubUser {
  login: string;
}

export interface GitHubInstallation {
  id: number;
  account: { login: string } | null;
  repository_selection: 'all' | 'selected';
}

export interface GitHubRepo {
  name: string;
  owner: { login: string };
  full_name: string;
  private: boolean;
}

interface InstallationsResponse {
  total_count: number;
  installations: GitHubInstallation[];
}

interface ReposResponse {
  total_count: number;
  repositories: GitHubRepo[];
}

function authHeaders(token: string): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${String(response.status)} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function getCurrentUser(token: string): Promise<GitHubUser> {
  return getJson<GitHubUser>('/user', token);
}

export async function listInstallations(token: string): Promise<GitHubInstallation[]> {
  const data = await getJson<InstallationsResponse>('/user/installations', token);
  return data.installations;
}

export async function listInstallationRepos(
  token: string,
  installationId: number,
): Promise<GitHubRepo[]> {
  const data = await getJson<ReposResponse>(
    `/user/installations/${String(installationId)}/repositories`,
    token,
  );
  return data.repositories;
}

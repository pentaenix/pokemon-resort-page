import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './load-env.mjs';

const API = 'https://api.github.com';

export function parseRepoSlug(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!url.hostname.includes('github.com')) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

export async function readSiteRepoSlug() {
  const site = JSON.parse(await readFile(join(projectRoot, 'public/data/site.json'), 'utf8'));
  return parseRepoSlug(process.env.GITHUB_REPO || site.repoUrl);
}

export function getGitHubConfig() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const repo = parseRepoSlug(process.env.GITHUB_REPO || '');
  return {
    token: token || null,
    repoFromEnv: repo,
    configured: Boolean(token),
  };
}

export async function resolveGitHubRepo() {
  const { token, repoFromEnv } = getGitHubConfig();
  const repo = repoFromEnv || await readSiteRepoSlug();
  if (!token) {
    return { token: null, repo, configured: false, error: 'Add GITHUB_TOKEN to .env.local (repo root), then restart npm run admin.' };
  }
  if (!repo) {
    return { token, repo: null, configured: true, error: 'Set GITHUB_REPO=owner/repo in .env.local or fix site.json repoUrl.' };
  }
  return { token, repo, configured: true, error: null };
}

async function githubFetch(path, { token, searchParams } = {}) {
  const url = new URL(`${API}${path}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pokemon-resort-operations-desk',
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}

export function mapGitHubIssueToCommunity(issue, { summary = '' } = {}) {
  const body = String(issue.body || '').replace(/\s+/g, ' ').trim();
  return {
    id: `gh-${issue.number}`,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    summary: summary || (body ? body.slice(0, 280) : 'Imported from GitHub.'),
    labels: (issue.labels || []).map((label) => (typeof label === 'string' ? label : label.name)).filter(Boolean),
    url: issue.html_url,
    linkedBug: '',
  };
}

export async function listGitHubIssues({ state = 'open', perPage = 40 } = {}) {
  const cfg = await resolveGitHubRepo();
  if (!cfg.configured) throw new Error(cfg.error);
  if (!cfg.repo) throw new Error(cfg.error);
  const payload = await githubFetch(`/repos/${cfg.repo}/issues`, {
    token: cfg.token,
    searchParams: { state, per_page: perPage, sort: 'updated', direction: 'desc' },
  });
  const issues = (Array.isArray(payload) ? payload : [])
    .filter((item) => !item.pull_request)
    .map((item) => mapGitHubIssueToCommunity(item));
  return { repo: cfg.repo, state, issues };
}

export async function getGitHubStatus() {
  const cfg = await resolveGitHubRepo();
  return {
    configured: cfg.configured,
    repo: cfg.repo,
    error: cfg.error,
    hint: cfg.configured && cfg.repo
      ? 'Fetch open issues and add them to the Operations page with one click.'
      : 'Local admin only — token never ships with the public site.',
  };
}

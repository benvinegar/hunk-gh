import { invocationError } from "./errors";
import type {
  GitHubCommitInvocation,
  GitHubCompareInvocation,
  GitHubPrInvocation,
  GitHubPullRequestLocator,
  GitHubRepository,
} from "./types";

const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;
const INVALID_GIT_REF_CHARACTERS = [" ", "~", "^", ":", "?", "*", "[", "\\"];

/** Detects terminal control characters that refs must never carry into output. */
function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

/** Checks one ref against Git's refname rules before it reaches GitHub's URL path. */
function isValidGitRef(value: string): boolean {
  if (new TextEncoder().encode(value).byteLength > 1024) return false;
  if (
    !value ||
    value === "@" ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{") ||
    hasControlCharacter(value) ||
    INVALID_GIT_REF_CHARACTERS.some((character) => value.includes(character))
  ) {
    return false;
  }
  return value.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

/** Validates and normalizes one positive GitHub pull-request number. */
function parsePullRequestNumber(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw invocationError(`Invalid pull-request number: ${value}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw invocationError(`Pull-request number is too large: ${value}`);
  }
  return String(number);
}

/** Validates and normalizes one owner/repository pair. */
export function parseGitHubRepository(value: string): GitHubRepository {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !REPOSITORY_PART.test(parts[0]) ||
    !REPOSITORY_PART.test(parts[1]) ||
    parts[0] === "." ||
    parts[0] === ".." ||
    parts[1] === "." ||
    parts[1] === ".."
  ) {
    throw invocationError(`Invalid GitHub repository: ${value}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

/** Parses one number, owner/repo#number shorthand, or github.com pull-request URL. */
export function parseGitHubPullRequestLocator(value: string): GitHubPullRequestLocator {
  if (/^#?\d+$/.test(value)) {
    return { number: parsePullRequestNumber(value.replace(/^#/, "")) };
  }

  const shorthand = /^([^/#]+\/[^/#]+)#([^#]+)$/.exec(value);
  if (shorthand) {
    const repository = parseGitHubRepository(shorthand[1]!);
    return { ...repository, number: parsePullRequestNumber(shorthand[2]!) };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invocationError(`Invalid GitHub pull-request locator: ${value}`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw invocationError("Pull-request URLs must be unmodified https://github.com URLs.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[2] !== "pull") {
    throw invocationError("GitHub pull-request URLs must end with /owner/repo/pull/number.");
  }
  const repository = parseGitHubRepository(`${parts[0]}/${parts[1]}`);
  return { ...repository, number: parsePullRequestNumber(parts[3]!) };
}

/** Parses raw PR tokens without consuming patch options after `--`. */
export function parseGitHubPrInvocation(args: readonly string[]): GitHubPrInvocation {
  const separator = args.indexOf("--");
  const ownedArgs = separator < 0 ? args : args.slice(0, separator);
  const patchArgs = separator < 0 ? [] : args.slice(separator + 1);
  if (ownedArgs.includes("--help") || ownedArgs.includes("-h")) {
    return { locator: { number: "1" }, patchArgs: Object.freeze([...patchArgs]), help: true };
  }

  let target: string | undefined;
  let explicitRepository: string | undefined;
  for (let index = 0; index < ownedArgs.length; index += 1) {
    const token = ownedArgs[index]!;
    if (token === "--repo") {
      if (explicitRepository !== undefined) throw invocationError("Specify --repo only once.");
      const value = ownedArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw invocationError("`--repo` requires an owner/repo value.");
      }
      explicitRepository = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--repo=")) {
      if (explicitRepository !== undefined) throw invocationError("Specify --repo only once.");
      explicitRepository = token.slice("--repo=".length);
      if (!explicitRepository) throw invocationError("`--repo` requires an owner/repo value.");
      continue;
    }
    if (token.startsWith("-")) throw invocationError(`Unknown gh option: ${token}`);
    if (target !== undefined) throw invocationError("Specify exactly one pull request.");
    target = token;
  }

  if (!target) throw invocationError("Specify one GitHub pull request.");
  const locator = parseGitHubPullRequestLocator(target);
  if (explicitRepository !== undefined) {
    parseGitHubRepository(explicitRepository);
    if (locator.owner || locator.repo) {
      throw invocationError(
        "Do not combine --repo with a locator that already names a repository.",
      );
    }
  }
  return { locator, explicitRepository, patchArgs: Object.freeze([...patchArgs]), help: false };
}

/** Parses one commit SHA, optional repository, and delegated patch options. */
export function parseGitHubCommitInvocation(args: readonly string[]): GitHubCommitInvocation {
  const separator = args.indexOf("--");
  const ownedArgs = separator < 0 ? args : args.slice(0, separator);
  const patchArgs = separator < 0 ? [] : args.slice(separator + 1);
  if (ownedArgs.includes("--help") || ownedArgs.includes("-h")) {
    return { sha: "0000000", patchArgs: Object.freeze([...patchArgs]), help: true };
  }

  let sha: string | undefined;
  let explicitRepository: string | undefined;
  for (let index = 0; index < ownedArgs.length; index += 1) {
    const token = ownedArgs[index]!;
    if (token === "--repo") {
      const value = ownedArgs[index + 1];
      if (explicitRepository !== undefined || !value || value.startsWith("--")) {
        throw invocationError("`--repo` requires one owner/repo value.");
      }
      explicitRepository = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--repo=")) {
      if (explicitRepository !== undefined) throw invocationError("Specify --repo only once.");
      explicitRepository = token.slice("--repo=".length);
      continue;
    }
    if (token.startsWith("-")) throw invocationError(`Unknown commit option: ${token}`);
    if (sha !== undefined) throw invocationError("Specify exactly one commit SHA.");
    sha = token;
  }

  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw invocationError(`Invalid commit SHA: ${sha ?? "missing"}`);
  }
  if (explicitRepository !== undefined) parseGitHubRepository(explicitRepository);
  return {
    sha: sha.toLowerCase(),
    explicitRepository,
    patchArgs: Object.freeze([...patchArgs]),
    help: false,
  };
}

/** Parses one base...head comparison, optional repository, and delegated patch options. */
export function parseGitHubCompareInvocation(args: readonly string[]): GitHubCompareInvocation {
  const separator = args.indexOf("--");
  const ownedArgs = separator < 0 ? args : args.slice(0, separator);
  const patchArgs = separator < 0 ? [] : args.slice(separator + 1);
  if (ownedArgs.includes("--help") || ownedArgs.includes("-h")) {
    return { base: "base", head: "head", patchArgs: Object.freeze([...patchArgs]), help: true };
  }

  let range: string | undefined;
  let explicitRepository: string | undefined;
  for (let index = 0; index < ownedArgs.length; index += 1) {
    const token = ownedArgs[index]!;
    if (token === "--repo") {
      if (explicitRepository !== undefined) throw invocationError("Specify --repo only once.");
      const value = ownedArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw invocationError("`--repo` requires an owner/repo value.");
      }
      explicitRepository = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--repo=")) {
      if (explicitRepository !== undefined) throw invocationError("Specify --repo only once.");
      explicitRepository = token.slice("--repo=".length);
      if (!explicitRepository) throw invocationError("`--repo` requires an owner/repo value.");
      continue;
    }
    if (token.startsWith("-")) throw invocationError(`Unknown compare option: ${token}`);
    if (range !== undefined) throw invocationError("Specify exactly one comparison.");
    range = token;
  }

  if (!range) throw invocationError("Specify one base...head comparison.");
  const parts = range.split("...");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw invocationError("Comparisons must use exactly one base...head range.");
  }
  const [base, head] = parts;
  if (!isValidGitRef(base) || !isValidGitRef(head)) {
    throw invocationError("Comparison refs are not valid Git refs or exceed 1024 UTF-8 bytes.");
  }
  if (explicitRepository !== undefined) parseGitHubRepository(explicitRepository);
  return {
    base,
    head,
    explicitRepository,
    patchArgs: Object.freeze([...patchArgs]),
    help: false,
  };
}

/**
 * Breach-list check for the admin password policy.
 *
 * NIST SP 800-63B's actual recommendation is length plus a breach check, with
 * NO forced rotation and NO composition rules — a 12-character passphrase you
 * can remember beats an 8-character one full of symbols that ends up on a
 * sticky note.
 *
 * This is one of the compensating controls for D-118 (Payload's KDF is
 * PBKDF2-SHA256 and is not configurable, so argon2id is unreachable without
 * discarding the entire auth stack). The controls we DO own are where the
 * strength has to come from.
 *
 * SCOPE, STATED HONESTLY: this is a local list of the most-abused passwords and
 * their obvious derivations, not a Have-I-Been-Pwned range query. It catches the
 * realistic failure — an admin choosing `Password123!` or `svdevelopers2026` —
 * without adding a network dependency to the login path or leaking a password
 * prefix to a third party. Upgrading to a k-anonymity HIBP lookup is a drop-in
 * replacement for this one function if the threat model ever justifies it.
 */

/** Seeds. Every entry is either a top-of-list password or SV-specific. */
const BREACHED_SEEDS = [
  'password',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'qwerty',
  'qwertyuiop',
  'azerty',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'starwars',
  'whatever',
  'freedom',
  'shadow',
  'master',
  'michael',
  'jennifer',
  'jordan',
  'hunter',
  'ranger',
  'buster',
  'secret',
  'changeme',
  'default',
  'temporary',
  'testtest',
  'abc123',
  'abcd1234',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '11111111',
  '00000000',
  'zaq12wsx',
  '1q2w3e4r',
  'qazwsxedc',
  // Project-specific: the single most likely choice an SV admin would make.
  'svdevelopers',
  'srrdevelopers',
  'svdeveloper',
  'developers',
  'realestate',
  'hyderabad',
  'telangana',
  'bhongir',
  'warangal',
  'plots',
  'sricity',
  'srivanam',
  'srinivasam',
]

/** Common suffixes appended to make a weak base "satisfy" a policy. */
const SUFFIXES = [
  '',
  '1',
  '12',
  '123',
  '1234',
  '!',
  '@',
  '#',
  '1!',
  '123!',
  '@123',
  '2024',
  '2025',
  '2026',
  '2027',
  '01',
  '001',
]

const buildBreachSet = (): ReadonlySet<string> => {
  const set = new Set<string>()
  for (const seed of BREACHED_SEEDS) {
    for (const suffix of SUFFIXES) {
      set.add(seed + suffix)
    }
  }
  return set
}

const BREACHED = buildBreachSet()

/**
 * Leetspeak folding, so `P@ssw0rd!` normalises onto `password!` and is caught.
 * Applied only for the lookup — the stored password is never transformed.
 */
const fold = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[@]/g, 'a')
    .replace(/[0]/g, 'o')
    .replace(/[1|!]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')

export const isBreachedPassword = (password: string): boolean => {
  const lower = password.toLowerCase()
  if (BREACHED.has(lower)) return true
  if (BREACHED.has(fold(password))) return true

  // A single repeated character of any length, e.g. "aaaaaaaaaaaa".
  if (/^(.)\1+$/.test(password)) return true

  // A pure ascending or descending run, e.g. "123456789012" / "abcdefghijkl".
  const codes = [...password].map((c) => c.charCodeAt(0))
  const monotonic = (step: number) => codes.every((c, i) => i === 0 || c === codes[i - 1]! + step)
  if (codes.length >= 6 && (monotonic(1) || monotonic(-1))) return true

  return false
}

/** Exposed so a test can assert the list is non-trivial and stays that way. */
export const breachedPasswordCount = (): number => BREACHED.size

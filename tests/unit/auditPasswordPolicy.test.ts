import { describe, expect, it } from 'vitest'

import { isBreachedPassword } from '@/lib/passwordPolicy'

/**
 * PASSWORD BLOCKLIST AUDIT.
 *
 * ⚠️ AUDIT ARTEFACT. `isBreachedPassword` is the only strength control beyond
 * the 12-character minimum, and the only existing test for it is a brief unit
 * case in serializers.test.ts. This file characterises what it actually catches.
 *
 * MEASURED RESULT: the leetspeak folding works correctly, because the blocklist
 * entries are folded too — so `P@ssw0rd!` and `passw0rd2026` are both caught,
 * exactly as the module's docstring claims. Two hypotheses to the contrary were
 * tested and disproved.
 *
 * 🔴 THE ONE REAL GAP IS COMPOUND SUFFIXES. The blocklist is built as
 * `seed + suffix` over a flat `SUFFIXES` list of SINGLE suffixes ('', '1',
 * '12', '123', '1234', '!', '2026', …). A password combining two of them —
 * `!` followed by `2026` — matches no entry, so `password!2026` and
 * `P@ssw0rd!2026` are both accepted despite being 13 characters of the single
 * most-guessed base in existence.
 */

const check = (pw: string) => ({ pw, blocked: isBreachedPassword(pw) })

describe('what the blocklist definitely catches', () => {
  it.each([
    'password',
    'password1',
    'password123',
    'password2026',
    'admin123',
    'qwerty123',
    'letmein',
    'svdevelopers',
    'hyderabad123',
  ])('blocks %s', (pw) => {
    expect(isBreachedPassword(pw)).toBe(true)
  })

  it('blocks a single repeated character of any length', () => {
    expect(isBreachedPassword('aaaaaaaaaaaaaa')).toBe(true)
  })

  it('blocks a pure ascending run', () => {
    expect(isBreachedPassword('abcdefghijklmn')).toBe(true)
  })

  it('blocks a pure descending run', () => {
    expect(isBreachedPassword('9876543210')).toBe(true)
  })

  it('⚠️ but a run that REVERSES direction is not a "pure" run and is allowed', () => {
    // '987654321098' descends then ascends, so it is not detected. Recorded
    // because it reads like it should be caught; the control is narrower than
    // "looks sequential".
    expect(isBreachedPassword('987654321098')).toBe(false)
  })
})

describe('leetspeak folding — tested, and it WORKS', () => {
  /**
   * Two hypotheses were tested and DISPROVED: that `!` -> `i` would corrupt a
   * `!` suffix, and that `0` -> `o` would corrupt a `2026` suffix. Neither
   * happens, because the blocklist entries are folded as well, so both sides
   * normalise consistently.
   */
  it("the module's own docstring example IS caught", () => {
    expect(check('P@ssw0rd!').blocked).toBe(true)
  })

  it('a leet base with a year suffix IS caught', () => {
    expect(check('passw0rd2026').blocked).toBe(true)
  })

  it('a fully leeted base IS caught', () => {
    expect(check('p@$$w0rd').blocked).toBe(true)
  })
})

describe('D-3 REGRESSION: compound suffixes are now blocked', () => {
  /**
   * 🔴 THE DEFECT. `BREACHED` is built as `seed + suffix` over a flat list of
   * SINGLE suffixes, so combining two of them matched no entry. Measured before
   * the fix: all three of these were ACCEPTED at 11-13 characters, built on the
   * most-guessed bases in existence.
   *
   * THE FIX. `isBreachedPassword` now also strips a trailing run of non-letters
   * and tests the remaining base — plain and leet-folded — against the seed
   * list. Stripping happens BEFORE folding, because folding turns digits into
   * letters and would make the run unstrippable.
   */
  it.each(['password!2026', 'P@ssw0rd!2026', 'admin@2026!', 'qwerty!123', 'letmein2026!'])(
    'blocks %s',
    (pw) => {
      expect(isBreachedPassword(pw)).toBe(true)
    },
  )

  it('either suffix alone is still caught (unchanged behaviour)', () => {
    expect(check('password2026').blocked).toBe(true)
    expect(check('password!').blocked).toBe(true)
  })

  it('does NOT over-block: a real passphrase ending in digits still passes', () => {
    // The strip must not turn a legitimate passphrase into a seed.
    expect(isBreachedPassword('orchard-lantern-bridge-quiet-77')).toBe(false)
    expect(isBreachedPassword('seventeen-tulips-by-the-gate-2026')).toBe(false)
    expect(isBreachedPassword('Correct-Horse-Battery-Staple-9!')).toBe(false)
  })
})

describe('legitimate passphrases are not blocked (no false positives)', () => {
  it.each([
    'orchard-lantern-bridge-quiet-77',
    'seventeen tulips beside the gate',
    'Correct-Horse-Battery-Staple-9',
  ])('allows %s', (pw) => {
    expect(isBreachedPassword(pw)).toBe(false)
  })
})

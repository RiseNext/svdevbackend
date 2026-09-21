'use client'

import type { TextFieldClientProps } from 'payload'

import { Button, FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import React, { useCallback } from 'react'

/**
 * THE ADMIN CONTROL FOR `projects.description` — AND ONLY FOR THE ADMIN.
 *
 * 🔴 WHY THIS EXISTS. `description` is `text` + `hasMany: true`, which is the
 * ONLY field type that satisfies the public contract
 * (`types/content.ts:72` — `description: readonly string[]`) with an IDENTITY
 * serialiser (`toPublicProject.ts:100` is `out.description = doc.description`).
 * That part of the design is correct and is deliberately NOT changed here.
 *
 * What was wrong was purely the EDITING EXPERIENCE. Payload renders a
 * `hasMany` text field as a CREATABLE REACT-SELECT — measured, not assumed:
 * `@payloadcms/ui/dist/fields/Text/Input.js:84` branches on `hasMany` into
 * `<ReactSelect isCreatable />`, and with no `admin.placeholder` set its
 * placeholder resolves to the `general:selectValue` translation, i.e. the
 * literal string "Select a value"
 * (`@payloadcms/translations/dist/languages/en.js:399`).
 *
 * The consequence an editor actually hits: typed text is only committed as a
 * chip on Enter. Click away instead and react-select DISCARDS the draft input
 * and re-shows its placeholder — which reads exactly like "my paragraph turned
 * into 'Select a value'". For 5000-character paragraphs that control is
 * unusable regardless.
 *
 * 🔴 WHAT THIS COMPONENT DOES NOT CHANGE — the whole point of fixing it here:
 *   · the field type stays `text` + `hasMany: true`
 *   · the stored shape is untouched
 *   · the serialised shape stays `string[]`
 *   · NO migration, NO schema change, NO API-contract change
 * It is a presentation swap: `useField<string[]>` reads and writes the exact
 * same `string[]` the built-in control did.
 */
export const ParagraphsField: React.FC<TextFieldClientProps> = (props) => {
  const {
    field: { label, maxRows, required, admin: { description } = {} },
    path: pathFromProps,
    readOnly,
  } = props

  const {
    customComponents: { Description, Error, Label } = {},
    disabled,
    path,
    setValue,
    showError,
    value,
  } = useField<string[]>({ potentiallyStalePath: pathFromProps })

  const paragraphs = Array.isArray(value) ? value : []
  const locked = Boolean(readOnly || disabled)
  const atMax = typeof maxRows === 'number' && paragraphs.length >= maxRows

  const update = useCallback(
    (next: string[]) => {
      if (!locked) setValue(next)
    },
    [locked, setValue],
  )

  const setAt = useCallback(
    (index: number, next: string) => {
      const copy = [...paragraphs]
      copy[index] = next
      update(copy)
    },
    [paragraphs, update],
  )

  const removeAt = useCallback(
    (index: number) => update(paragraphs.filter((_, i) => i !== index)),
    [paragraphs, update],
  )

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta
      if (target < 0 || target >= paragraphs.length) return
      const copy = [...paragraphs]
      const [moved] = copy.splice(index, 1)
      copy.splice(target, 0, moved as string)
      update(copy)
    },
    [paragraphs, update],
  )

  return (
    <div className={['field-type', 'textarea', showError && 'error'].filter(Boolean).join(' ')}>
      {Label ?? <FieldLabel label={label} path={path} required={required} />}
      {Error ?? <FieldError path={path} showError={showError} />}

      {paragraphs.map((paragraph, index) => (
        // The index IS the correct key here: these rows are positional, the
        // value is what the editor is part-way through typing, and a
        // value-based key would remount the textarea on every keystroke and
        // throw away the caret position.
        <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <textarea
            disabled={locked}
            id={`field-${path.replace(/\./g, '__')}-${index}`}
            onChange={(e) => setAt(index, e.target.value)}
            rows={4}
            style={{ flex: 1, width: '100%' }}
            value={paragraph ?? ''}
          />
          {!locked && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <Button
                aria-label={`Move paragraph ${index + 1} up`}
                buttonStyle="secondary"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                size="small"
              >
                ↑
              </Button>
              <Button
                aria-label={`Move paragraph ${index + 1} down`}
                buttonStyle="secondary"
                disabled={index === paragraphs.length - 1}
                onClick={() => move(index, 1)}
                size="small"
              >
                ↓
              </Button>
              <Button
                aria-label={`Remove paragraph ${index + 1}`}
                buttonStyle="secondary"
                onClick={() => removeAt(index)}
                size="small"
              >
                ✕
              </Button>
            </div>
          )}
        </div>
      ))}

      {!locked && (
        <Button buttonStyle="secondary" disabled={atMax} onClick={() => update([...paragraphs, ''])}>
          Add paragraph
        </Button>
      )}

      {Description ?? <FieldDescription description={description} path={path} />}
    </div>
  )
}

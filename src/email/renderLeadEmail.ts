import { DEFAULT_SITE_NAME } from '@/lib/constants'

import { escapeHtml } from './escapeHtml'
import { renderBrandedEmail, renderPlainEmail, type BrandedEmailArgs } from './renderBrandedEmail'

type LeadLike = {
  name: string
  phone: string
  projectNameSnapshot?: string | null
  message?: string | null
  source: string
  sourcePath?: string | null
  createdAt: string
}

/**
 * The sales notification.
 *
 * 🔴 EVERY ATTACKER-CONTROLLED FIELD IS ESCAPED. `name` and `message` are public
 * free text. They are stripped of HTML on the way in (a `beforeValidate` field
 * hook) AND escaped on the way out — two layers, because the inbound strip is a
 * transformation and the outbound escape is an encoding, and a single layer of
 * either has historically been the thing that failed.
 */
const buildArgs = (lead: LeadLike, siteName = DEFAULT_SITE_NAME): BrandedEmailArgs => ({
  heading: 'New enquiry',
  intro: `${lead.name} asked to be called back${
    lead.projectNameSnapshot ? ` about ${lead.projectNameSnapshot}` : ''
  }.`,
  rows: [
    ['Name', escapeHtml(lead.name)],
    ['Phone', escapeHtml(lead.phone)],
    ['Project', escapeHtml(lead.projectNameSnapshot ?? '— no preference —')],
    ['Message', escapeHtml(lead.message ?? '')],
    ['Source', escapeHtml(lead.source)],
    ['Page', escapeHtml(lead.sourcePath ?? '')],
    ['Received', escapeHtml(new Date(lead.createdAt).toISOString())],
  ],
  footer: `Sent automatically by the ${siteName} website. Reply to the enquirer by phone — this mailbox is not monitored.`,
})

export const renderLeadEmail = (lead: LeadLike, siteName?: string): string =>
  renderBrandedEmail(buildArgs(lead, siteName))

export const renderLeadEmailText = (lead: LeadLike, siteName?: string): string =>
  renderPlainEmail(buildArgs(lead, siteName))

// Shared JSDoc types. This file has no runtime code.
// The shapes for Filter, FilterCriteria, FilterAction and Label match the Gmail API v1 exactly.

/**
 * @typedef {object} FilterCriteria
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [subject]
 * @property {string} [query]          Gmail search syntax ("Has the words").
 * @property {string} [negatedQuery]   Gmail search syntax ("Doesn't have").
 * @property {boolean} [hasAttachment]
 * @property {boolean} [excludeChats]
 * @property {number} [size]           Bytes.
 * @property {'larger'|'smaller'|'unspecified'} [sizeComparison]
 */

/**
 * @typedef {object} FilterAction
 * @property {string[]} [addLabelIds]
 * @property {string[]} [removeLabelIds]
 * @property {string} [forward]        A verified forwarding address.
 */

/**
 * @typedef {object} Filter
 * @property {string} [id]             Absent for a filter that is not created yet.
 * @property {FilterCriteria} criteria
 * @property {FilterAction} action
 */

/**
 * @typedef {object} Label
 * @property {string} id
 * @property {string} name
 * @property {'system'|'user'} type
 * @property {{textColor?: string, backgroundColor?: string}} [color]
 * @property {'labelShow'|'labelShowIfUnread'|'labelHide'} [labelListVisibility]
 * @property {'show'|'hide'} [messageListVisibility]
 */

/**
 * @typedef {object} ForwardingAddress
 * @property {string} forwardingEmail
 * @property {'accepted'|'pending'|'verificationStatusUnspecified'} verificationStatus
 */

/**
 * Friendly, UI-level view of a FilterAction. core/actions.js converts both ways.
 * @typedef {object} FriendlyAction
 * @property {boolean} archive          Skip the inbox (remove INBOX).
 * @property {boolean} markRead         Remove UNREAD.
 * @property {boolean} star             Add STARRED.
 * @property {boolean} trash            Add TRASH (delete).
 * @property {boolean} neverSpam        Remove SPAM.
 * @property {'always'|'never'|null} important  Add or remove IMPORTANT.
 * @property {null|'CATEGORY_PERSONAL'|'CATEGORY_SOCIAL'|'CATEGORY_PROMOTIONS'|'CATEGORY_UPDATES'|'CATEGORY_FORUMS'} category
 * @property {string[]} labelIds        User label IDs to add.
 * @property {string|null} forward
 * @property {string[]} otherAdd        Unknown label IDs to add (kept as-is, round trip safe).
 * @property {string[]} otherRemove     Unknown label IDs to remove (kept as-is).
 */

/**
 * @typedef {'error'|'warning'|'info'} Severity
 */

/**
 * A problem or a hint found by core/analyse.js or core/limits.js.
 * @typedef {object} Issue
 * @property {string} code              Stable machine code, for example 'duplicate', 'too-long'.
 * @property {Severity} severity
 * @property {string[]} filterIds
 * @property {string} message           Plain English, one sentence.
 * @property {string} [fix]             Plain English suggestion.
 */

/**
 * One step of a change plan. core/bulk.js and core/consolidate.js make plans;
 * gmail/executor.js runs them. An edit is a 'replace': create the new filter first,
 * then delete the old one, because the Gmail API has no update method.
 * @typedef {{op: 'create', filter: Filter} |
 *           {op: 'delete', filterId: string, previous: Filter} |
 *           {op: 'replace', filterId: string, previous: Filter, filter: Filter} |
 *           {op: 'createLabel', name: string}} PlanStep
 */

/**
 * @typedef {object} Plan
 * @property {string} title            Plain English, for example "Merge 4 filters into 1".
 * @property {PlanStep[]} steps
 * @property {number} filterDelta      Change in filter count when the plan completes.
 */

/**
 * The contract that both gmail/client.js (real API) and gmail/mock.js (demo and tests) implement.
 * @typedef {object} GmailApi
 * @property {() => Promise<Filter[]>} listFilters
 * @property {(filter: Filter) => Promise<Filter>} createFilter      Returns the filter with its new id.
 * @property {(id: string) => Promise<void>} deleteFilter
 * @property {() => Promise<Label[]>} listLabels
 * @property {(name: string) => Promise<Label>} createLabel
 * @property {() => Promise<ForwardingAddress[]>} listForwardingAddresses
 * @property {(q: string, max?: number) => Promise<MessagePreview[]>} searchMessages  Needs the 'preview' permission tier.
 * @property {(q: string, add: string[], remove: string[], onProgress?: (done: number) => void) => Promise<number>} applyToExisting  Needs the 'apply' tier. Returns count.
 */

/**
 * @typedef {object} MessagePreview
 * @property {string} id
 * @property {string} from
 * @property {string} subject
 * @property {string} date             ISO 8601.
 * @property {string} [snippet]
 */

/**
 * Permission tiers. Each tier adds scopes to the one before it.
 * 'basic': filters, labels, forwarding list. 'preview': read mail to show matches. 'apply': change existing mail.
 * @typedef {'basic'|'preview'|'apply'} PermissionTier
 */

/**
 * @typedef {object} Template
 * @property {string} id
 * @property {string} name
 * @property {string} group             For example 'Shopping and money'.
 * @property {string} description       What it catches, plain English.
 * @property {string} rationale         Why this is good practice.
 * @property {FilterCriteria} criteria
 * @property {{labelName?: string, archive?: boolean, markRead?: boolean, star?: boolean,
 *            important?: 'always'|'never'|null, neverSpam?: boolean, category?: FriendlyAction['category']}} defaults
 * @property {Array<{key: string, label: string, type: 'boolean'|'text', default: any, help?: string}>} options
 * @property {'low'|'medium'|'high'} risk  'high' means it can hide mail a person needs.
 * @property {string[]} [cautions]      Plain English warnings shown before creation.
 * @property {string[]} [regions]       For example ['GB'] for UK-only senders. Empty means global.
 */

export {};

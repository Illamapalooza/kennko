import { describe, expect, it } from 'vitest'
import type { Order, TillCustomer } from '@kennko/core'
import { customerLine, maskCode, onlineCardLabel, splitReward, stampButtonLabel, typedCode } from '../src/loyaltyText.ts'

const cust = (over: Partial<TillCustomer> = {}): TillCustomer => ({ code: 'KC-7F3-K9Q-XAM', catName: null, stampMode: 'digital', stamps: 5, fullCards: 0, ...over })

describe('maskCode', () => {
  it('keeps the first and last group', () => {
    expect(maskCode('KC-7F3-K9Q-XAM')).toBe('KC-7F3-…-XAM')
    expect(maskCode('7F3K9QXAM')).toBe('KC-7F3-…-XAM')
  })
  it('shows nothing for something that is not a code', () => expect(maskCode('nope')).toBe(''))
})

describe('customerLine', () => {
  it('shows the stamps', () => expect(customerLine(cust())).toBe('Card KC-7F3-…-XAM · 5 of 8 stamps'))
  it('leads with the cat name when there is one', () => {
    expect(customerLine(cust({ catName: 'Mochi' }))).toBe('Mochi · KC-7F3-…-XAM · 5 of 8 stamps')
    expect(customerLine(cust({ catName: null }))).toBe('Card KC-7F3-…-XAM · 5 of 8 stamps')
  })
  it('says when a free drink is ready', () => expect(customerLine(cust({ stamps: 0, fullCards: 1 }))).toBe('Card KC-7F3-…-XAM · 0 of 8 stamps · Free drink ready'))
  it('counts several free drinks', () => expect(customerLine(cust({ fullCards: 2 }))).toMatch(/· 2 free drinks ready$/))
  it('says paper cards are stamped by hand', () => expect(customerLine(cust({ stampMode: 'paper' }))).toBe('Paper card: stamp their paper card'))
  it('waits for the internet when the till could not look them up', () => {
    expect(customerLine(null)).toBe('Will confirm when back online')
    expect(customerLine(null, 'Too many lookups. Try again soon.')).toBe('Too many lookups. Try again soon.')
  })
})

describe('typedCode while typing', () => {
  // The input is controlled: each keystroke feeds the previous formatted value plus one character back in.
  const type = (chars: string) => [...chars].reduce((shown, ch) => typedCode(shown + ch), '')
  const backspace = (shown: string, n: number) => {
    for (let i = 0; i < n; i++) shown = typedCode(shown.slice(0, -1))
    return shown
  }

  it('adds the KC- prefix once, not on every keystroke', () => {
    expect(type('j')).toBe('KC-J')
    expect(type('jy')).toBe('KC-JY')
    expect(type('jyecy98ua')).toBe('KC-JYE-CY9-8UA')
  })

  it('keeps a code that itself starts with K and C', () => {
    expect(type('kc7f3k9qx')).toBe('KC-KC7-F3K-9QX')
  })

  it('stops at 9 symbols and backspaces cleanly', () => {
    expect(type('jyecy98uazz')).toBe('KC-JYE-CY9-8UA')
    expect(backspace(type('jy'), 1)).toBe('KC-J')
    expect(backspace(type('jy'), 2)).toBe('')
  })
})

describe('typedCode', () => {
  it('adds KC- and groups in threes while typing', () => {
    expect(typedCode('')).toBe('')
    expect(typedCode('7f')).toBe('KC-7F')
    expect(typedCode('7f3k')).toBe('KC-7F3-K')
    expect(typedCode('kc-7f3-k9q-xam')).toBe('KC-7F3-K9Q-XAM')
    expect(typedCode('7F3K9QXAMZZZ')).toBe('KC-7F3-K9Q-XAM')
  })
  it('drops characters that are not in codes', () => expect(typedCode('7-0 1!f')).toBe('KC-7F'))
})

const order = (over: Partial<Order> = {}): Pick<Order, 'customerCode' | 'stamped' | 'status' | 'lines'> => ({
  customerCode: 'KC-7F3-K9Q-XAM', stamped: false, status: 'queued', lines: [{ reward: undefined } as never], ...over,
})

describe('stampButtonLabel', () => {
  it('offers a stamp for a linked sale', () => expect(stampButtonLabel(order())).toBe('Stamp card'))
  it('shows it is done', () => expect(stampButtonLabel(order({ stamped: true }))).toBe('Stamped'))
  it('offers nothing without a customer or on a voided sale', () => {
    expect(stampButtonLabel(order({ customerCode: null }))).toBeNull()
    expect(stampButtonLabel(order({ status: 'voided' }))).toBeNull()
  })
  it('offers nothing when the only drink was the free one', () => expect(stampButtonLabel(order({ lines: [{ reward: true } as never] }))).toBeNull())
})

describe('onlineCardLabel', () => {
  it('maps each card state', () => {
    expect(onlineCardLabel('stamp')).toBe('Stamp at pickup')
    expect(onlineCardLabel('stamped')).toBe('Stamped')
    expect(onlineCardLabel('paper')).toBe('Paper card')
    expect(onlineCardLabel(null)).toBeNull()
    expect(onlineCardLabel(undefined)).toBeNull()
  })
})

describe('splitReward', () => {
  const line = (quantity: number, key = 'a') => ({ key, quantity }) as { key: string; quantity: number; reward?: boolean }
  it('marks a single drink', () => {
    expect(splitReward([line(1)], 'a', () => 'n')).toEqual([{ key: 'a', quantity: 1, reward: true }])
  })
  it('splits a bigger line into one free drink and the rest', () => {
    expect(splitReward([line(3), line(1, 'b')], 'a', () => 'n')).toEqual([
      { key: 'a', quantity: 1, reward: true }, { key: 'n', quantity: 2 }, { key: 'b', quantity: 1 },
    ])
  })
  it('moves the free drink off any earlier line', () => {
    expect(splitReward([{ ...line(1), reward: true }, line(1, 'b')], 'b', () => 'n')).toEqual([{ key: 'a', quantity: 1 }, { key: 'b', quantity: 1, reward: true }])
  })
})
